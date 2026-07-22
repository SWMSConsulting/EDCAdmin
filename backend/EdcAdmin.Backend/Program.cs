using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.HttpOverrides;

// EDC Admin backend (BFF):
//  - hosts the DevExtreme Angular SPA (static files + SPA fallback),
//  - protects everything with a cookie login (credentials from configuration/secret),
//  - reverse-proxies /api/edc/* to the EDC Management API, injecting the X-Api-Key server-side so
//    the powerful management key never reaches the browser.
// The app is meant to sit behind an HTTPS ingress (Let's Encrypt); optional IP allow-listing is done
// at the ingress. Nothing here talks to the tractusx-edc or DataspaceOperator source.

var builder = WebApplication.CreateBuilder(args);

// Behind the ingress/reverse proxy: honour X-Forwarded-* so the app knows the request is HTTPS.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownNetworks.Clear();
    o.KnownProxies.Clear();
});

// --- Authentication: cookie login -------------------------------------------------------------
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "edcadmin.auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
        // API-style app: never 302-redirect to a login page; return 401/403 so the SPA reacts.
        options.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        options.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy("authenticated", p => p.RequireAuthenticatedUser());

// --- Reverse proxy to the EDC Management API (YARP), configured from app settings ---------------
var edcBaseUrl = builder.Configuration["EdcManagement:BaseUrl"]
    ?? throw new InvalidOperationException("EdcManagement:BaseUrl is required (e.g. http://alice-edc-controlplane:8081/management).");
var edcApiKey = builder.Configuration["EdcManagement:ApiKey"] ?? "";

// HttpClient for the server-side download proxy (EDR retrieval + data-plane fetch).
builder.Services.AddHttpClient();

// HttpClient for the BDRS directory lookup; BDRS replies gzip-encoded, so decompress automatically.
builder.Services.AddHttpClient("directory").ConfigurePrimaryHttpMessageHandler(() =>
    new HttpClientHandler { AutomaticDecompression = System.Net.DecompressionMethods.GZip });

builder.Services.AddReverseProxy().LoadFromMemory(
    routes:
    [
        new Yarp.ReverseProxy.Configuration.RouteConfig
        {
            RouteId = "edc-management",
            ClusterId = "edc",
            // Only authenticated users may reach the management API through the proxy.
            AuthorizationPolicy = "authenticated",
            Match = new Yarp.ReverseProxy.Configuration.RouteMatch { Path = "/api/edc/{**remainder}" },
            Transforms =
            [
                // /api/edc/v3/assets  ->  {BaseUrl}/v3/assets
                new Dictionary<string, string> { ["PathRemovePrefix"] = "/api/edc" },
                // inject the management key server-side; the browser never sees it
                new Dictionary<string, string> { ["RequestHeader"] = "X-Api-Key", ["Set"] = edcApiKey },
            ],
        },
    ],
    clusters:
    [
        new Yarp.ReverseProxy.Configuration.ClusterConfig
        {
            ClusterId = "edc",
            Destinations = new Dictionary<string, Yarp.ReverseProxy.Configuration.DestinationConfig>
            {
                ["management"] = new() { Address = edcBaseUrl },
            },
        },
    ]);

var app = builder.Build();

app.UseForwardedHeaders();
app.UseDefaultFiles();     // serve index.html at "/"
app.UseStaticFiles();      // the built Angular SPA in wwwroot
app.UseAuthentication();
app.UseAuthorization();

// --- Health (public) ---------------------------------------------------------------------------
app.MapGet("/healthz", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

// --- Auth endpoints ----------------------------------------------------------------------------
app.MapPost("/api/auth/login", async (LoginRequest req, IConfiguration cfg, HttpContext ctx) =>
{
    var user = cfg["Auth:Username"] ?? "admin";
    var pass = cfg["Auth:Password"] ?? "";
    // Fail closed: no password configured => no login possible.
    if (string.IsNullOrEmpty(pass) || !ConstantTimeEquals(req.Username, user) || !ConstantTimeEquals(req.Password, pass))
        return Results.Json(new { error = "invalid credentials" }, statusCode: StatusCodes.Status401Unauthorized);

    var identity = new ClaimsIdentity(
        [new Claim(ClaimTypes.Name, user)],
        CookieAuthenticationDefaults.AuthenticationScheme);
    await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
    return Results.Ok(new { user });
});

app.MapPost("/api/auth/logout", async (HttpContext ctx) =>
{
    await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.Ok();
});

app.MapGet("/api/auth/me", (HttpContext ctx) =>
    ctx.User.Identity?.IsAuthenticated == true
        ? Results.Ok(new { user = ctx.User.Identity!.Name })
        : Results.Json(new { error = "unauthenticated" }, statusCode: StatusCodes.Status401Unauthorized));

// Read-only view of the (deploy-fixed) connector coordinates, so the UI can show them.
app.MapGet("/api/config", (IConfiguration cfg) => Results.Ok(new
{
    edcBaseUrl = cfg["EdcManagement:BaseUrl"],
    participant = cfg["EdcManagement:ParticipantId"],
    bpn = cfg["EdcManagement:Bpn"],
    dspAddress = cfg["EdcManagement:DspAddress"],
})).RequireAuthorization("authenticated");

// --- Dataspace participant directory (BDRS) ----------------------------------------------------
// Every dataspace member may read the central BPN->DID directory, but the operator requires a
// Membership Verifiable Presentation as Bearer. We run the tractusx presentation flow server-side:
//   1) get a self-issued token from our own IdentityHub STS (scoped to MembershipCredential),
//   2) ask our IdentityHub to build a Membership VP (the IH signs it with our key),
//   3) present that VP to the operator's BDRS and return the decoded BPN->DID map.
// The STS client secret stays server-side (like the management key); the browser only sees the list.
app.MapGet("/api/directory", async (IConfiguration cfg, IHttpClientFactory httpFactory, CancellationToken ct) =>
{
    var did = cfg["EdcManagement:ParticipantId"] ?? "";
    var stsUrl = cfg["Directory:IhStsTokenUrl"] ?? "";
    var presBase = cfg["Directory:IhPresentationBaseUrl"] ?? "";
    var bdrsUrl = cfg["Directory:BdrsDirectoryUrl"] ?? "";
    var stsSecret = cfg["Directory:StsClientSecret"] ?? "";
    var scope = cfg["Directory:Scope"] ?? "org.eclipse.tractusx.vc.type:MembershipCredential:read";

    if (string.IsNullOrEmpty(did) || string.IsNullOrEmpty(stsUrl) || string.IsNullOrEmpty(presBase)
        || string.IsNullOrEmpty(bdrsUrl) || string.IsNullOrEmpty(stsSecret))
        return Results.Json(new { error = "directory lookup is not configured" }, statusCode: StatusCodes.Status501NotImplemented);

    var http = httpFactory.CreateClient("directory");

    // 1) self-issued token from our IdentityHub STS
    using var stsResp = await http.PostAsync(stsUrl, new FormUrlEncodedContent(new Dictionary<string, string>
    {
        ["grant_type"] = "client_credentials",
        ["client_id"] = did,
        ["client_secret"] = stsSecret,
        ["audience"] = did,
        ["bearer_access_scope"] = scope,
    }), ct);
    if (!stsResp.IsSuccessStatusCode)
        return Results.Json(new { error = "STS token request failed", step = "sts", status = (int)stsResp.StatusCode }, statusCode: StatusCodes.Status502BadGateway);
    var accessToken = (await stsResp.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct)).GetProperty("access_token").GetString();

    // 2) ask our IdentityHub for a Membership VP (participantContextId = base64(DID))
    var b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(did));
    using var presReq = new HttpRequestMessage(HttpMethod.Post, $"{presBase.TrimEnd('/')}/{b64}/presentations/query");
    presReq.Headers.TryAddWithoutValidation("Authorization", $"Bearer {accessToken}");
    presReq.Content = new StringContent(
        $"{{\"@context\":[\"https://w3id.org/tractusx-trust/v0.8\"],\"@type\":\"PresentationQueryMessage\",\"scope\":[\"{scope}\"]}}",
        Encoding.UTF8, "application/json");
    using var presResp = await http.SendAsync(presReq, ct);
    if (!presResp.IsSuccessStatusCode)
        return Results.Json(new { error = "presentation query failed", step = "presentation", status = (int)presResp.StatusCode }, statusCode: StatusCodes.Status502BadGateway);
    var presProp = (await presResp.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct)).GetProperty("presentation");
    var vp = presProp.ValueKind == JsonValueKind.Array ? presProp[0].GetString() : presProp.GetString();

    // 3) present the VP to the central BDRS directory
    using var dirReq = new HttpRequestMessage(HttpMethod.Get, bdrsUrl);
    dirReq.Headers.TryAddWithoutValidation("Authorization", $"Bearer {vp}");
    using var dirResp = await http.SendAsync(dirReq, ct);
    if (!dirResp.IsSuccessStatusCode)
        return Results.Json(new { error = "BDRS directory request failed", step = "bdrs", status = (int)dirResp.StatusCode }, statusCode: StatusCodes.Status502BadGateway);
    var map = await dirResp.Content.ReadFromJsonAsync<Dictionary<string, string>>(cancellationToken: ct) ?? new();
    var selfBpn = cfg["EdcManagement:Bpn"];

    // Enrich each entry with its DSP protocol endpoint, resolved from the participant's did:web document.
    var enriched = await Task.WhenAll(map.Select(async kv => new
    {
        bpn = kv.Key,
        did = kv.Value,
        self = kv.Key == selfBpn,
        dspUrl = await ResolveDspEndpointAsync(http, kv.Value, ct),
    }));
    return Results.Ok(enriched.OrderBy(e => e.bpn, StringComparer.Ordinal));
}).RequireAuthorization("authenticated");

// --- Data download proxy -----------------------------------------------------------------------
// Consumer-pull download: for a STARTED transfer process the EDC has cached an EDR. We fetch that
// EDR's data address (endpoint + authorization) from the Management API server-side, then stream the
// bytes from the provider's data plane to the browser. Keeping this server-side avoids a CORS/token
// problem in the SPA (the data-plane public API has no CORS for this origin, and the EDR token must
// not be exposed to the browser).
app.MapGet("/api/download/{transferProcessId}", async (string transferProcessId, IHttpClientFactory httpFactory) =>
{
    var http = httpFactory.CreateClient();
    var mgmtBase = edcBaseUrl.TrimEnd('/');

    // 1) resolve the EDR data address for this transfer process
    using var edrReq = new HttpRequestMessage(HttpMethod.Get,
        $"{mgmtBase}/v3/edrs/{Uri.EscapeDataString(transferProcessId)}/dataaddress");
    edrReq.Headers.TryAddWithoutValidation("X-Api-Key", edcApiKey);
    using var edrResp = await http.SendAsync(edrReq);
    if (!edrResp.IsSuccessStatusCode)
        return Results.Problem($"EDR nicht verfügbar (Transfer evtl. noch nicht STARTED): {(int)edrResp.StatusCode}",
            statusCode: StatusCodes.Status502BadGateway);

    var edr = await edrResp.Content.ReadFromJsonAsync<JsonElement>();
    var endpoint = JsonProp(edr, "endpoint", "https://w3id.org/edc/v0.0.1/ns/endpoint");
    var authorization = JsonProp(edr, "authorization", "https://w3id.org/edc/v0.0.1/ns/authorization");
    if (string.IsNullOrEmpty(endpoint))
        return Results.Problem("EDR enthält keinen Endpoint.", statusCode: StatusCodes.Status502BadGateway);

    // 2) fetch the actual data from the provider data plane and stream it back
    using var dataReq = new HttpRequestMessage(HttpMethod.Get, endpoint);
    if (!string.IsNullOrEmpty(authorization))
        dataReq.Headers.TryAddWithoutValidation("Authorization", authorization);
    var dataResp = await http.SendAsync(dataReq, HttpCompletionOption.ResponseHeadersRead);
    var contentType = dataResp.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";
    var stream = await dataResp.Content.ReadAsStreamAsync();
    return Results.Stream(stream, contentType, fileDownloadName: $"{transferProcessId}.dat");
}).RequireAuthorization("authenticated");

// --- Proxy + SPA fallback ----------------------------------------------------------------------
app.MapReverseProxy();
app.MapFallbackToFile("index.html");   // Angular client-side routing

app.Run();

// Read a string property from a (possibly namespaced) JSON-LD object, trying each candidate name.
static string? JsonProp(JsonElement obj, params string[] names)
{
    if (obj.ValueKind != JsonValueKind.Object) return null;
    foreach (var name in names)
        if (obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
            return v.GetString();
    return null;
}

static bool ConstantTimeEquals(string? a, string? b) =>
    CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(a ?? ""), Encoding.UTF8.GetBytes(b ?? ""));

// did:web:host[:seg...] -> https://host[/seg...]/did.json (host at root uses /.well-known/did.json).
static string? DidWebToDocumentUrl(string did)
{
    const string prefix = "did:web:";
    if (string.IsNullOrEmpty(did) || !did.StartsWith(prefix, StringComparison.Ordinal)) return null;
    var parts = did[prefix.Length..].Split(':');
    var host = Uri.UnescapeDataString(parts[0]);
    return parts.Length == 1
        ? $"https://{host}/.well-known/did.json"
        : $"https://{host}/{string.Join('/', parts[1..].Select(Uri.UnescapeDataString))}/did.json";
}

// Resolve a participant's DSP protocol endpoint from its did:web document (best-effort; null on failure).
static async Task<string?> ResolveDspEndpointAsync(HttpClient http, string did, CancellationToken ct)
{
    var url = DidWebToDocumentUrl(did);
    if (url is null) return null;
    try
    {
        using var resp = await http.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode) return null;
        using var jd = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        if (!jd.RootElement.TryGetProperty("service", out var services) || services.ValueKind != JsonValueKind.Array)
            return null;
        string? fallback = null;
        foreach (var s in services.EnumerateArray())
        {
            var type = s.TryGetProperty("type", out var t) ? t.GetString() : null;
            var ep = s.TryGetProperty("serviceEndpoint", out var e) ? e.GetString() : null;
            if (string.IsNullOrEmpty(ep)) continue;
            if (type == "ProtocolEndpoint") return ep;                 // explicit DSP endpoint
            if (ep.Contains("/dsp", StringComparison.OrdinalIgnoreCase)) fallback ??= ep;
        }
        return fallback;
    }
    catch { return null; }
}

internal sealed record LoginRequest(string Username, string Password);

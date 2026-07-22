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

internal sealed record LoginRequest(string Username, string Password);

import { Router, type IRouter } from "express";

const router: IRouter = Router();

interface TwitterTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

interface TwitterUserResponse {
  data: {
    id: string;
    name: string;
    username: string;
    profile_image_url?: string;
  };
}

router.post("/x/exchange", async (req, res) => {
  try {
    const { code, codeVerifier, redirectUri } = req.body ?? {};
    if (!code || !codeVerifier || !redirectUri) {
      return res.status(400).json({ error: "code, codeVerifier and redirectUri are required" });
    }

    const clientId = process.env["TWITTER_CLIENT_ID"];
    const clientSecret = process.env["TWITTER_CLIENT_SECRET"];
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: "Twitter OAuth is not configured on the server" });
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const detail = await tokenRes.text();
      return res.status(502).json({ error: "Failed to exchange X authorization code", detail });
    }

    const tokenData = (await tokenRes.json()) as TwitterTokenResponse;

    const userRes = await fetch("https://api.twitter.com/2/users/me?user.fields=profile_image_url", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      const detail = await userRes.text();
      return res.status(502).json({ error: "Failed to fetch X profile", detail });
    }

    const userData = (await userRes.json()) as TwitterUserResponse;

    return res.json({
      name: userData.data.name,
      username: userData.data.username,
      avatar: userData.data.profile_image_url?.replace("_normal", "_400x400") ?? null,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface DiscordUserResponse {
  id: string;
  username: string;
  global_name: string | null;
  discriminator: string;
  avatar: string | null;
}

router.post("/discord/exchange", async (req, res) => {
  try {
    const { code, redirectUri } = req.body ?? {};
    if (!code || !redirectUri) {
      return res.status(400).json({ error: "code and redirectUri are required" });
    }

    const clientId = process.env["DISCORD_CLIENT_ID"];
    const clientSecret = process.env["DISCORD_CLIENT_SECRET"];
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: "Discord OAuth is not configured on the server" });
    }

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const detail = await tokenRes.text();
      return res.status(502).json({ error: "Failed to exchange Discord authorization code", detail });
    }

    const tokenData = (await tokenRes.json()) as DiscordTokenResponse;

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      const detail = await userRes.text();
      return res.status(502).json({ error: "Failed to fetch Discord profile", detail });
    }

    const userData = (await userRes.json()) as DiscordUserResponse;

    const avatar = userData.avatar
      ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${Number(userData.discriminator || "0") % 5}.png`;

    return res.json({
      name: userData.global_name ?? userData.username,
      username: userData.username,
      avatar,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;

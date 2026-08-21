const TOKEN_KEY = "ar-editor-token";

export function createApi(baseUrl) {
  const url = (pathname) => `${baseUrl.replace(/\/$/, "")}${pathname}`;

  const authHeaders = () => {
    const token = sessionStorage.getItem(TOKEN_KEY);
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const parse = async (response) => {
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (!response.ok) {
      const error = new Error(body.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return body;
  };

  return {
    hasSession() {
      return Boolean(sessionStorage.getItem(TOKEN_KEY));
    },

    async login(password) {
      const body = await parse(
        await fetch(url("/auth"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password })
        })
      );
      sessionStorage.setItem(TOKEN_KEY, body.token);
    },

    async loadContent() {
      return parse(await fetch(url("/content"), { headers: authHeaders() }));
    },

    async save(payload) {
      return parse(
        await fetch(url("/content"), {
          method: "PUT",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload)
        })
      );
    }
  };
}

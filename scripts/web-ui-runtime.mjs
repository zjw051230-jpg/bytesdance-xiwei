export const DEFAULT_WEB_PORT = 9999;
export const DEFAULT_WEB_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 8787;

export function getWebPort(env = process.env) {
  return normalizePort(env.WEB_PORT, DEFAULT_WEB_PORT);
}

export function getWebHost(env = process.env) {
  return String(env.WEB_HOST || DEFAULT_WEB_HOST).trim() || DEFAULT_WEB_HOST;
}

export function getWebBaseUrl(env = process.env) {
  return String(env.WEB_BASE_URL || `http://${getWebHost(env)}:${getWebPort(env)}`).trim();
}

export function getApiBaseUrl(env = process.env) {
  return String(env.API_BASE_URL || `http://${getWebHost(env)}:${DEFAULT_API_PORT}`).trim();
}

export function getViteServerConfig(env = process.env) {
  return {
    host: getWebHost(env),
    port: getWebPort(env),
    strictPort: true,
    proxy: {
      "/api": getApiBaseUrl(env)
    }
  };
}

export function getViteDevArgs(env = process.env) {
  return [
    "--host",
    getWebHost(env),
    "--port",
    String(getWebPort(env)),
    "--strictPort"
  ];
}

export function getPortInUsePattern(port = getWebPort()) {
  return `node_modules.*vite.*--port\\s+${Number(port)}`;
}

function normalizePort(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

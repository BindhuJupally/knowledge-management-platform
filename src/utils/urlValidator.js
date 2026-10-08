const dns = require('dns').promises;
const net = require('net');

/**
 * Check if an IPv4 address is in a private, loopback, or reserved range
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return true;

  const [p0, p1] = parts;

  // 0.0.0.0/8 (Current network)
  if (p0 === 0) return true;

  // 10.0.0.0/8 (Private)
  if (p0 === 10) return true;

  // 127.0.0.0/8 (Loopback)
  if (p0 === 127) return true;

  // 169.254.0.0/16 (Link-local / Cloud metadata: 169.254.169.254)
  if (p0 === 169 && p1 === 254) return true;

  // 172.16.0.0/12 (Private)
  if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;

  // 192.168.0.0/16 (Private)
  if (p0 === 192 && p1 === 168) return true;

  // 100.64.0.0/10 (Carrier-grade NAT)
  if (p0 === 100 && p1 >= 64 && p1 <= 127) return true;

  // 192.0.0.0/24, 192.0.2.0/24 (Documentation/Test)
  if (p0 === 192 && p1 === 0) return true;

  // 224.0.0.0/4 (Multicast)
  if (p0 >= 224 && p0 <= 239) return true;

  // 240.0.0.0/4 (Reserved)
  if (p0 >= 240) return true;

  return false;
}

/**
 * Check if an IPv6 address is in a private, loopback, or reserved range
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();

  // Loopback ::1
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

  // Unspecified ::
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (normalized.startsWith('::ffff:')) {
    const ipv4Part = normalized.replace('::ffff:', '');
    if (net.isIPv4(ipv4Part)) {
      return isPrivateIPv4(ipv4Part);
    }
  }

  // Unique local addresses fc00::/7 (fc00... or fd00...)
  if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) return true;

  // Link-local unicast fe80::/10 (fe80... to febf...)
  if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return true;

  return false;
}

/**
 * Validate that a URL is safe to crawl (SSRF protection)
 * @param {string} rawUrl
 * @returns {Promise<{ valid: boolean, normalizedUrl?: string, hostname?: string, error?: string }>}
 */
async function validateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'A valid URL string is required' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err) {
    return { valid: false, error: `Invalid URL format: ${err.message}` };
  }

  // Only allow http: and https: protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: `Unsupported protocol '${parsed.protocol}'. Only http: and https: are allowed`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and standard local domains
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return { valid: false, error: `Access to local/private domain '${hostname}' is forbidden (SSRF protection)` };
  }

  // Direct IP checks (if user passed an IP literal)
  if (net.isIPv4(hostname)) {
    if (isPrivateIPv4(hostname)) {
      return { valid: false, error: `Access to private IPv4 address '${hostname}' is forbidden (SSRF protection)` };
    }
  } else if (net.isIPv6(hostname)) {
    if (isPrivateIPv6(hostname)) {
      return { valid: false, error: `Access to private IPv6 address '${hostname}' is forbidden (SSRF protection)` };
    }
  } else {
    // Resolve DNS and verify that resolved IPs are not private
    try {
      const addresses = await dns.lookup(hostname, { all: true });
      if (!addresses || addresses.length === 0) {
        return { valid: false, error: `Unable to resolve host '${hostname}'` };
      }

      for (const { address, family } of addresses) {
        if (family === 4 && isPrivateIPv4(address)) {
          return {
            valid: false,
            error: `Host '${hostname}' resolves to private IP '${address}' (SSRF protection)`,
          };
        }
        if (family === 6 && isPrivateIPv6(address)) {
          return {
            valid: false,
            error: `Host '${hostname}' resolves to private IPv6 '${address}' (SSRF protection)`,
          };
        }
      }
    } catch (dnsErr) {
      return { valid: false, error: `DNS resolution failed for '${hostname}': ${dnsErr.message}` };
    }
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
    hostname,
  };
}

module.exports = {
  validateUrl,
  isPrivateIPv4,
  isPrivateIPv6,
};

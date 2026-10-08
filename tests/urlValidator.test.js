const dns = require('dns').promises;
const { validateUrl, isPrivateIPv4, isPrivateIPv6 } = require('../src/utils/urlValidator');

describe('URL and SSRF Validator', () => {
  describe('isPrivateIPv4', () => {
    test('identifies loopback addresses', () => {
      expect(isPrivateIPv4('127.0.0.1')).toBe(true);
      expect(isPrivateIPv4('127.0.1.5')).toBe(true);
    });

    test('identifies RFC 1918 private ranges', () => {
      expect(isPrivateIPv4('10.0.0.1')).toBe(true);
      expect(isPrivateIPv4('172.16.0.1')).toBe(true);
      expect(isPrivateIPv4('172.31.255.255')).toBe(true);
      expect(isPrivateIPv4('192.168.1.1')).toBe(true);
    });

    test('identifies cloud metadata / link-local', () => {
      expect(isPrivateIPv4('169.254.169.254')).toBe(true);
    });

    test('allows public IPs', () => {
      expect(isPrivateIPv4('8.8.8.8')).toBe(false);
      expect(isPrivateIPv4('1.1.1.1')).toBe(false);
      expect(isPrivateIPv4('142.250.190.46')).toBe(false);
    });
  });

  describe('isPrivateIPv6', () => {
    test('identifies IPv6 loopback', () => {
      expect(isPrivateIPv6('::1')).toBe(true);
    });

    test('identifies unique local and link-local', () => {
      expect(isPrivateIPv6('fc00::1')).toBe(true);
      expect(isPrivateIPv6('fe80::1')).toBe(true);
    });
  });

  describe('validateUrl', () => {
    test('rejects non-string or empty inputs', async () => {
      const res1 = await validateUrl('');
      expect(res1.valid).toBe(false);

      const res2 = await validateUrl(null);
      expect(res2.valid).toBe(false);
    });

    test('rejects non-http/https protocols', async () => {
      const resFtp = await validateUrl('ftp://example.com/file');
      expect(resFtp.valid).toBe(false);
      expect(resFtp.error).toContain('Unsupported protocol');

      const resFile = await validateUrl('file:///etc/passwd');
      expect(resFile.valid).toBe(false);
    });

    test('rejects localhost and private IP hosts (SSRF)', async () => {
      const resLocal = await validateUrl('http://localhost:3000/api');
      expect(resLocal.valid).toBe(false);
      expect(resLocal.error).toContain('forbidden');

      const resLoopback = await validateUrl('http://127.0.0.1:8080');
      expect(resLoopback.valid).toBe(false);
      expect(resLoopback.error).toContain('forbidden');

      const resPrivate = await validateUrl('http://192.168.1.50/admin');
      expect(resPrivate.valid).toBe(false);

      const resMetadata = await validateUrl('http://169.254.169.254/latest/meta-data');
      expect(resMetadata.valid).toBe(false);
    });

    test('accepts valid public URLs', async () => {
      jest.spyOn(dns, 'lookup').mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
      const res = await validateUrl('https://example.com/docs');
      expect(res.valid).toBe(true);
      expect(res.hostname).toBe('example.com');
      expect(res.normalizedUrl).toBe('https://example.com/docs');
      dns.lookup.mockRestore();
    });

    test('rejects domains that resolve to private IPs (DNS rebinding)', async () => {
      jest.spyOn(dns, 'lookup').mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
      const res = await validateUrl('https://rebind-test.com/secret');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('resolves to private IP');
      dns.lookup.mockRestore();
    });
  });
});

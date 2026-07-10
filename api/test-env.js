export default async function handler(req, res) {
  const key = process.env.OPENROUTER_API_KEY;
  const keyExists = !!key;
  const keyLength = key ? key.length : 0;
  const keyPrefix = key ? key.slice(0, 8) : '';
  const keySuffix = key ? key.slice(-8) : '';

  return res.status(200).json({
    keyExists,
    keyLength,
    keyPrefix,
    keySuffix,
    nodeVersion: process.version,
    allKeys: Object.keys(process.env).filter(k => !k.toLowerCase().includes('key') && !k.toLowerCase().includes('secret') && !k.toLowerCase().includes('token'))
  });
}

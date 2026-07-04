const trimTrailingSlash = (value = '') => value.toString().trim().replace(/\/+$/, '');

const getPublicBaseUrl = () => {
  return trimTrailingSlash(
    process.env.PUBLIC_BASE_URL ||
      process.env.BASE_URL ||
      process.env.PUBLIC_API_URL?.replace(/\/api\/?$/, '') ||
      '',
  );
};

const buildPublicUrl = (value) => {
  if (value === undefined || value === null) return '';

  let raw = value.toString().trim();

  if (!raw) return '';

  raw = raw.replace(/\\/g, '/');

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }

  if (raw.startsWith('api/uploads/')) {
    raw = raw.replace('api/uploads/', 'uploads/');
  }

  if (raw.startsWith('/api/uploads/')) {
    raw = raw.replace('/api/uploads/', '/uploads/');
  }

  const baseUrl = getPublicBaseUrl();

  if (!baseUrl) return raw;

  if (raw.startsWith('/')) {
    return `${baseUrl}${raw}`;
  }

  return `${baseUrl}/${raw}`;
};

module.exports = {
  buildPublicUrl,
  getPublicBaseUrl,
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep pdf-parse (and its bundled pdf.js) as a plain Node require on the
  // server instead of letting the bundler rewrite it.
  serverExternalPackages: ['pdf-parse'],
};

export default nextConfig;

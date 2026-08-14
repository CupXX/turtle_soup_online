import nextConfig from 'eslint-config-next/core-web-vitals';

const config = [...nextConfig, { ignores: ['.next/**', 'dist/**'] }];

export default config;

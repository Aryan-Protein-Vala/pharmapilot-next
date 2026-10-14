/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow running seamlessly in local/Vercel/Tauri environments
  env: {
    NEXT_PUBLIC_APP_NAME: 'PharmaPilot Next',
  },
};

export default nextConfig;

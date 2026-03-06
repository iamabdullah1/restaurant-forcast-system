/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * 🎓 serverExternalPackages
   *    These packages use Node.js-specific features (child_process,
   *    file system, native modules) that Next.js can't bundle for
   *    the browser. We tell Next.js to keep them as external requires
   *    on the server side only.
   *
   *    - @modelcontextprotocol/sdk: spawns child processes (STDIO transport)
   *    - @langchain/core: uses Node.js internals
   */
  serverExternalPackages: [
    "@modelcontextprotocol/sdk",
    "@langchain/core",
    "@langchain/xai",
    "langchain",
    "zod",
  ],
};

export default nextConfig;

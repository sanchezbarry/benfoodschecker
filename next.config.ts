import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * No `serverActions.bodySizeLimit` override here on purpose. Certificates are
   * uploaded from the browser straight to Supabase Storage (see
   * app/dashboard/upload-file.ts), so the Server Action only ever receives the
   * form's text fields plus a storage path. The 1 MB default is ample, and
   * raising it wouldn't help anyway: Vercel caps function request bodies at
   * 4.5 MB whatever this is set to.
   */
};

export default nextConfig;

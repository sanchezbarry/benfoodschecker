import Image from "next/image";

import logo from "@/public/benfoods-logo.png";
import { cn } from "@/lib/utils";

/**
 * The Ben Foods wordmark (288×66, transparent background), served from
 * /public so it renders on white without a plate behind it.
 */
export function BrandLogo({
  className,
  priority,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={logo}
      alt="Ben Foods (S) Pte Ltd"
      priority={priority}
      className={cn("h-8 w-auto", className)}
    />
  );
}

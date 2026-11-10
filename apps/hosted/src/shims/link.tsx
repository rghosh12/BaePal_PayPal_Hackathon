import { type AnchorHTMLAttributes } from "react";
import { navigate } from "./navigation";
export default function Link({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          href?.startsWith("/") &&
          !href.startsWith("//") &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !props.target
        ) {
          event.preventDefault();
          navigate(href);
        }
      }}
    />
  );
}

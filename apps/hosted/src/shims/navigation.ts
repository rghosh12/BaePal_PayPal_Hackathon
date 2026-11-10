import { useSyncExternalStore } from "react";
const subscribe = (callback: () => void) => {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
};
export function navigate(path: string) {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw Error("Invalid internal route");
  history.pushState({}, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}
export function usePathname() {
  return useSyncExternalStore(
    subscribe,
    () => location.pathname,
    () => "/",
  );
}
export function useRouter() {
  return { push: navigate };
}

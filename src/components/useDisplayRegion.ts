import { useEffect } from "react";
import { setDisplayRegion } from "../ui/display";

/**
 * Tell the display module which region's money to speak while this component is on screen.
 *
 * It is set during render, not in an effect, because the words below it are built in the same render pass and must already
 * know the region. Setting a module value there is safe because it is idempotent (the same person gives the same value on every
 * pass, including React's repeated passes in development), and it is switched off again when the screen goes away so one
 * mounted screen never changes how another one reads.
 */
export function useDisplayRegion(region: string): void {
  setDisplayRegion(region);
  useEffect(() => () => setDisplayRegion(undefined), []);
}

/**
 * Runs before every test file. Testing Library's findBy and waitFor give up after one second by default, which is
 * enough on a fast laptop and not on a loaded CI runner (a failure there once looked like a product bug). Five seconds
 * costs nothing when the screen is ready and removes the deadline as a source of flakes.
 */
import { configure } from "@testing-library/react";
import { afterEach } from "vitest";
import { setDisplayRegion } from "../src/ui/display";

configure({ asyncUtilTimeout: 5000 });

// A screen sets the display region while it renders; a test must never inherit the previous test's.
afterEach(() => setDisplayRegion(undefined));

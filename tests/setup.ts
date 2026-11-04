/**
 * Runs before every test file. Testing Library's findBy and waitFor give up after one second by default, which is
 * enough on a fast laptop and not on a loaded CI runner (a failure there once looked like a product bug). Five seconds
 * costs nothing when the screen is ready and removes the deadline as a source of flakes.
 */
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 5000 });

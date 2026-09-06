/**
 * MCP-3 — deep-link Figma (`lib/figma-link.ts`).
 *
 * La fonction est pure et ne sonde rien : ces tests verrouillent uniquement la composition
 * d'URL choisie et documentée en tête du module (clé de fichier seule, `node-id` passé tel
 * quel — le « : » est un sub-delim autorisé en valeur de requête). Aucun appel réseau.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildFigmaDeepLink } from "@/lib/figma-link";

describe("buildFigmaDeepLink", () => {
  test("clé et node-id simples → URL sans slug de nom", () => {
    assert.equal(
      buildFigmaDeepLink("abc123DEF", "1:2"),
      "https://www.figma.com/file/abc123DEF?node-id=1:2",
    );
  });

  test("le « : » du node-id est conservé tel quel (choix documenté)", () => {
    assert.equal(
      buildFigmaDeepLink("KEY", "123:456"),
      "https://www.figma.com/file/KEY?node-id=123:456",
    );
  });

  test("deux clés différentes produisent deux liens distincts", () => {
    assert.notEqual(
      buildFigmaDeepLink("A", "1:2"),
      buildFigmaDeepLink("B", "1:2"),
    );
  });
});

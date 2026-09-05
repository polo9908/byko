/**
 * BACK-4 — `lib/settings-store.ts` : schéma persisté, `encode`/`decode`, et le magasin qui en
 * résulte. Aucun test n'écrit dans `~/.bcc` (répertoire temporaire via `withTempVault`, comme
 * `test/token-storage.test.ts`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createSecret, revealSecret } from "@/lib/secret";
import {
  createSettingsStore,
  decodeSettingsDocument,
  emptySettingsDocument,
  encodeSettingsDocument,
  type PersistedSettingsDocument,
} from "@/lib/settings-store";

import { withTempVault } from "./helpers/temp-vault";

describe("encodeSettingsDocument / decodeSettingsDocument — round-trip", () => {
  test("un document avec les trois blocs connectés survit à encode() puis decode()", () => {
    const document: PersistedSettingsDocument = {
      schemaVersion: 1,
      jira: {
        status: "connected",
        instanceUrl: "https://exemple.atlassian.net",
        email: "a@b.com",
        apiToken: createSecret("jira-jeton-de-test"),
        account: { accountName: "Jane Doe" },
      },
      figma: {
        status: "connected",
        apiToken: createSecret("figd_jeton-de-test"),
        account: { accountName: "jane" },
      },
      ai: {
        status: "connected",
        provider: "anthropic",
        apiToken: createSecret("sk-ant-jeton-de-test"),
      },
    };

    const encoded = encodeSettingsDocument(document);
    const decoded = decodeSettingsDocument(encoded);

    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.value.jira.status, "connected");
    assert.equal(decoded.value.figma.status, "connected");
    assert.equal(decoded.value.ai.status, "connected");
    if (decoded.value.jira.status === "connected") {
      assert.equal(revealSecret(decoded.value.jira.apiToken), "jira-jeton-de-test");
      assert.equal(decoded.value.jira.account.accountName, "Jane Doe");
    }
  });

  test("encode() ne produit que des données JSON ordinaires : le jeton apparaît en clair dans le JSON produit (le chiffrement vient après, dans lib/token-storage.ts)", () => {
    const document = emptySettingsDocument();
    const withJira: PersistedSettingsDocument = {
      ...document,
      jira: {
        status: "connected",
        instanceUrl: "https://exemple.atlassian.net",
        email: "a@b.com",
        apiToken: createSecret("jeton-visible-avant-chiffrement"),
        account: { accountName: "Jane" },
      },
    };
    const encoded = encodeSettingsDocument(withJira);
    // encode() lui-même n'est pas chargé de chiffrer : c'est `encryptDocument`
    // (`lib/token-storage.ts`) qui le fait juste après, sur CE document.
    assert.equal(JSON.stringify(encoded).includes("jeton-visible-avant-chiffrement"), true);
  });

  test("schemaVersion différente -> refusé, jamais interprété de travers", () => {
    const result = decodeSettingsDocument({
      schemaVersion: 999,
      jira: { status: "not_connected" },
      figma: { status: "not_connected" },
      ai: { status: "not_connected" },
    });
    assert.equal(result.ok, false);
  });

  test("bloc Jira au format inattendu -> refusé (pas de accountName manquant toléré)", () => {
    const result = decodeSettingsDocument({
      schemaVersion: 1,
      jira: { status: "connected", instanceUrl: "https://x", email: "a@b.com", apiToken: "t" },
      figma: { status: "not_connected" },
      ai: { status: "not_connected" },
    });
    assert.equal(result.ok, false);
  });

  test("lastError absent est un état légitime (aucun échec connu), pas un défaut fabriqué", () => {
    const result = decodeSettingsDocument({
      schemaVersion: 1,
      jira: { status: "not_connected" },
      figma: { status: "not_connected" },
      ai: { status: "not_connected" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.jira.status, "not_connected");
    if (result.value.jira.status === "not_connected") {
      assert.equal(result.value.jira.lastError, undefined);
    }
  });

  test("figma skipped se décode distinctement de not_connected", () => {
    const result = decodeSettingsDocument({
      schemaVersion: 1,
      jira: { status: "not_connected" },
      figma: { status: "skipped" },
      ai: { status: "not_connected" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.figma.status, "skipped");
  });
});

describe("createSettingsStore — coffre chiffré sur répertoire temporaire", () => {
  test("write() puis read() restitue le jeton Jira exactement (fermer/rouvrir l'app)", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const document: PersistedSettingsDocument = {
        ...emptySettingsDocument(),
        jira: {
          status: "connected",
          instanceUrl: "https://exemple.atlassian.net",
          email: "a@b.com",
          apiToken: createSecret("jira-jeton-persiste"),
          account: { accountName: "Jane Doe" },
        },
      };
      const written = await store.write(document);
      assert.equal(written.status, "written");

      // Nouvelle instance de magasin : simule la fermeture puis la réouverture de l'app.
      const reopened = createSettingsStore(location);
      const read = await reopened.read();
      assert.equal(read.status, "loaded");
      if (read.status !== "loaded") return;
      assert.equal(read.value.jira.status, "connected");
      if (read.value.jira.status === "connected") {
        assert.equal(revealSecret(read.value.jira.apiToken), "jira-jeton-persiste");
      }
    });
  });

  test("le fichier écrit sur disque ne contient jamais le jeton en clair", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const document: PersistedSettingsDocument = {
        ...emptySettingsDocument(),
        ai: {
          status: "connected",
          provider: "openai",
          apiToken: createSecret("sk-jamais-visible-sur-le-disque"),
        },
      };
      await store.write(document);

      const raw = await readFile(location.configPath, "utf8");
      assert.equal(raw.includes("sk-jamais-visible-sur-le-disque"), false);
    });
  });

  test("coffre illisible -> `error`, jamais confondu avec `absent` (ne réserve pas l'onboarding)", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      await store.write(emptySettingsDocument());
      const { writeFile } = await import("node:fs/promises");
      await writeFile(location.configPath, "{corrompu", "utf8");

      const result = await store.read();
      assert.equal(result.status, "error");
    });
  });

  test("read() sur un coffre inexistant rend `absent`, pas une valeur vide fabriquée", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const result = await store.read();
      assert.deepEqual(result, { status: "absent" });
    });
  });
});

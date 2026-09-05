/**
 * ARCHI-7 — Verrouille l'invariant `encode`/`decode` pur de `lib/token-storage.ts` (ARCHI-3),
 * avant que BACK-4 n'écrive dessus. Chaque test cite l'invariant du module qu'il vérifie ;
 * aucune assertion n'affirme un comportement non observé ici ou dans `lib/token-storage.ts`.
 *
 * Aucun test n'écrit dans `~/.bcc` : le point d'injection est `VaultLocation`, sur un
 * répertoire temporaire (`test/helpers/temp-vault.ts`), jamais le coffre réel de l'utilisateur.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";

import {
  createEncryptedStore,
  decryptDocument,
  encryptDocument,
  type EncryptedStoreOptions,
  type VaultLocation,
} from "@/lib/token-storage";
import { createSecret, type Secret } from "@/lib/secret";

import { withTempVault } from "./helpers/temp-vault";

/** Store à l'identité : `encode`/`decode` ne transforment rien, pratique pour isoler le reste. */
function identityStore<T>(location: VaultLocation): ReturnType<typeof createEncryptedStore<T>> {
  return createEncryptedStore<T>({
    decode: (document) => ({ ok: true, value: document as T }),
    encode: (value) => value,
    location,
  });
}

/* -------------------------------------------------------------------------- */
/* `encryptDocument` / `decryptDocument` — fonctions pures, sans disque         */
/* -------------------------------------------------------------------------- */

describe("encryptDocument / decryptDocument — invariant pur", () => {
  test("clé de taille invalide -> key_invalid, au chiffrement comme au déchiffrement", () => {
    const shortKey = Buffer.alloc(16);

    const encrypted = encryptDocument(shortKey, { a: 1 });
    assert.equal(encrypted.status, "error");
    if (encrypted.status === "error") assert.equal(encrypted.kind, "key_invalid");

    const decrypted = decryptDocument(shortKey, "{}");
    assert.equal(decrypted.status, "error");
    if (decrypted.status === "error") assert.equal(decrypted.kind, "key_invalid");
  });

  test("round-trip : ce qui est chiffré ressort identique au déchiffrement", () => {
    const key = randomBytes(32);
    const document = {
      jira: { instanceUrl: "https://exemple.atlassian.net", email: "a@b.com" },
      liste: [1, 2, 3],
      vide: null,
    };

    const encrypted = encryptDocument(key, document);
    assert.equal(encrypted.status, "ok");
    if (encrypted.status !== "ok") return;

    const decrypted = decryptDocument(key, encrypted.value);
    assert.equal(decrypted.status, "ok");
    if (decrypted.status !== "ok") return;

    assert.deepEqual(decrypted.value, document);
  });

  test("l'enveloppe écrite ne rend que format/version/iv/tag/ct — jamais le clair", () => {
    const key = randomBytes(32);
    const document = { apiToken: "figd_valeur-en-clair-jamais-visible" };

    const encrypted = encryptDocument(key, document);
    assert.equal(encrypted.status, "ok");
    if (encrypted.status !== "ok") return;

    assert.equal(encrypted.value.includes("valeur-en-clair-jamais-visible"), false);
    const envelope: unknown = JSON.parse(encrypted.value);
    assert.equal(typeof envelope, "object");
    assert.deepEqual(
      Object.keys(envelope as Record<string, unknown>).sort(),
      ["alg", "ct", "format", "iv", "tag", "v"],
    );
  });

  test("un Secret non déballé À LA RACINE est refusé (invalid_payload), le jeton n'apparaît pas dans le message", () => {
    const key = randomBytes(32);
    const secret = createSecret("figd_racine-jamais-persistee-000");

    const result = encryptDocument(key, secret);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "invalid_payload");
    assert.match(result.message, /racine/);
    assert.equal(result.message.includes("racine-jamais-persistee-000"), false);
  });

  test("un Secret imbriqué est refusé, son chemin est cité, le jeton ne l'est jamais", () => {
    const key = randomBytes(32);
    const secret = createSecret("figd_imbrique-jamais-persiste-111");

    const result = encryptDocument(key, { jira: { apiToken: secret } });

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "invalid_payload");
    assert.match(result.message, /jira\.apiToken/);
    assert.equal(result.message.includes("imbrique-jamais-persiste-111"), false);
  });

  test("un Secret caché derrière un toJSON intermédiaire est quand même détecté", () => {
    const key = randomBytes(32);
    const secret = createSecret("figd_derriere-tojson-222");
    // `resolveJSONValue` doit suivre EXACTEMENT la résolution `toJSON` de `JSON.stringify` :
    // le Secret est une propriété ORDINAIRE du retour du premier `toJSON`, pas rappelée.
    const document = {
      toJSON: () => ({ apiToken: secret, toJSON: () => "safe" }),
    };

    const result = encryptDocument(key, document);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "invalid_payload");
  });

  test("toJSON n'est appelé qu'UNE FOIS par traversée, jamais rappelé sur son propre retour", () => {
    const key = randomBytes(32);
    let calls = 0;
    const document = {
      toJSON: () => {
        calls += 1;
        return {
          toJSON: () => {
            throw new Error("rappelé deux fois au même niveau : la garde n'est pas fidèle à JSON.stringify");
          },
        };
      },
    };

    const result = encryptDocument(key, document);

    // Deux traversées INDÉPENDANTES du document (la garde `findSecretPath`, puis le
    // sérialiseur `JSON.stringify`) appellent chacune `toJSON` une fois — jamais deux fois
    // au même niveau au sein d'une même traversée, ce qui est précisément le bug corrigé
    // que documente `resolveJSONValue`. Si la garde rappelait `toJSON` sur son propre
    // retour, l'exception ci-dessus serait levée avant d'atteindre cette ligne.
    assert.equal(calls, 2);
    assert.equal(result.status, "ok");
  });

  test("un Secret porté par une fonction augmentée d'un toJSON est détecté (fonction = Object en ECMA-262)", () => {
    const key = randomBytes(32);
    const secret = createSecret("figd_porte-par-fonction-444");
    const carrier = Object.assign(() => undefined, {
      toJSON: () => ({ apiToken: secret }),
    });

    const result = encryptDocument(key, { block: carrier });

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "invalid_payload");
  });

  test("un accesseur qui lève pendant l'inspection refuse l'écriture, sans recopier l'exception", () => {
    const key = randomBytes(32);
    const document = {
      get apiToken(): string {
        throw new Error("fuite-potentielle-du-jeton-dans-l-exception-555");
      },
    };

    const result = encryptDocument(key, document);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "invalid_payload");
    assert.equal(
      result.message.includes("fuite-potentielle-du-jeton-dans-l-exception-555"),
      false,
    );
  });

  test(
    "limite documentée du module : une lecture NON PURE (accesseur non déterministe) peut " +
      "montrer un graphe sans Secret à la garde puis un Secret au sérialiseur — charge de " +
      "pureté déléguée à encode(), pas garantie par ce module (commentaire de `encryptDocument`)",
    () => {
      const key = randomBytes(32);
      const secret = createSecret("figd_lecture-non-pure-666");
      let reads = 0;
      const document = {
        // Premier appel (lu par la garde `findSecretPath`) : rien de suspect.
        // Second appel (lu par `JSON.stringify`) : le Secret.
        get apiToken(): string | Secret {
          reads += 1;
          return reads === 1 ? "valeur-anodine" : secret;
        },
      };

      const result = encryptDocument(key, document);

      // Documenté en commentaire du module (`resolveJSONValue`/`encryptDocument`) : ce
      // n'est PAS un bug de `lib/token-storage.ts`, c'est pourquoi `encode()` (BACK-4) DOIT
      // produire un document pur. Ce test verrouille le comportement observé, pas un
      // comportement souhaité : si un jour `encryptDocument` se met à relire le document
      // une seule fois, ce test devra changer en même temps que le commentaire qui le motive.
      assert.equal(reads, 2);
      assert.equal(result.status, "ok");
      if (result.status !== "ok") return;

      // Ce qui atterrit sur le disque est le MASQUE du Secret (son `toJSON()`), pas le
      // jeton en clair : la fuite documentée porte sur l'intégrité de la garde, pas sur la
      // confidentialité du jeton lui-même.
      const decrypted = decryptDocument(key, result.value);
      assert.equal(decrypted.status, "ok");
      if (decrypted.status !== "ok") return;
      const value = decrypted.value as { apiToken: string };
      assert.equal(value.apiToken.startsWith("••••"), true);
    },
  );

  test("document non sérialisable (référence circulaire) est refusé", () => {
    const key = randomBytes(32);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const result = encryptDocument(key, circular);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "invalid_payload");
  });

  test("document `undefined` (JSON.stringify -> undefined) est refusé", () => {
    const key = randomBytes(32);

    const result = encryptDocument(key, undefined);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "invalid_payload");
  });

  test("base64 non canonique dans l'enveloppe -> corrupted, pas déchiffré à tort", () => {
    const key = randomBytes(32);
    const encrypted = encryptDocument(key, { a: 1 });
    assert.equal(encrypted.status, "ok");
    if (encrypted.status !== "ok") return;

    const envelope = JSON.parse(encrypted.value) as Record<string, string>;
    // `!` n'appartient pas à l'alphabet base64 : `Buffer.from` permissif l'ignorerait
    // silencieusement (cf. commentaire de `decodeBase64`), le ré-encodage canonique le
    // détecte.
    envelope.iv = `${envelope.iv.slice(0, -1)}!`;

    const result = decryptDocument(key, JSON.stringify(envelope));

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "corrupted");
  });

  test("version d'enveloppe inconnue -> unsupported_version, la version est citée", () => {
    const key = randomBytes(32);
    const encrypted = encryptDocument(key, { a: 1 });
    assert.equal(encrypted.status, "ok");
    if (encrypted.status !== "ok") return;

    const envelope = JSON.parse(encrypted.value) as Record<string, unknown>;
    envelope.v = 999;

    const result = decryptDocument(key, JSON.stringify(envelope));

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "unsupported_version");
    assert.match(result.message, /999/);
  });

  test("tag GCM invalide -> decryption_failed, jamais un extrait du clair dans le message", () => {
    const key = randomBytes(32);
    const encrypted = encryptDocument(key, { secretLike: "ne-doit-jamais-apparaitre-777" });
    assert.equal(encrypted.status, "ok");
    if (encrypted.status !== "ok") return;

    const envelope = JSON.parse(encrypted.value) as Record<string, string>;
    const tamperedTag = Buffer.from(envelope.tag, "base64");
    tamperedTag[0] = (tamperedTag[0] ?? 0) ^ 0xff;
    envelope.tag = tamperedTag.toString("base64");

    const result = decryptDocument(key, JSON.stringify(envelope));

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "decryption_failed");
    assert.equal(result.message.includes("ne-doit-jamais-apparaitre-777"), false);
  });

  test("fichier vide ou JSON tronqué -> corrupted", () => {
    const key = randomBytes(32);
    const result = decryptDocument(key, "");
    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "corrupted");
  });

  test("marqueur de format différent -> corrupted, ce n'est pas un coffre de cette application", () => {
    const key = randomBytes(32);
    const result = decryptDocument(key, JSON.stringify({ format: "autre-app", v: 1 }));
    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "corrupted");
  });

  test("champ d'enveloppe manquant -> corrupted", () => {
    const key = randomBytes(32);
    const result = decryptDocument(
      key,
      JSON.stringify({ format: "bcc-vault", v: 1, alg: "aes-256-gcm", iv: "AAAAAAAAAAAAAAAA" }),
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "corrupted");
  });

  test("contenu déchiffré qui n'est pas du JSON valide -> invalid_content", () => {
    // Enveloppe construite indépendamment de `encryptDocument`, avec le format documenté
    // en tête de `lib/token-storage.ts` (AES-256-GCM, AAD `bcc-vault:1:aes-256-gcm`) :
    // c'est la seule façon de faire arriver un texte non-JSON APRÈS un déchiffrement réussi
    // (un chiffrement réussi via `encryptDocument` ne produit toujours que du JSON).
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from("bcc-vault:1:aes-256-gcm", "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update("ceci n'est pas du JSON {{{", "utf8"),
      cipher.final(),
    ]);
    const envelope = JSON.stringify({
      format: "bcc-vault",
      v: 1,
      alg: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ct: ciphertext.toString("base64"),
    });

    const result = decryptDocument(key, envelope);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.kind, "invalid_content");
  });
});

/* -------------------------------------------------------------------------- */
/* `createEncryptedStore` — absent / error / écritures, sur disque temporaire  */
/* -------------------------------------------------------------------------- */

describe("createEncryptedStore — absent, error et écriture atomique (répertoire temporaire)", () => {
  test("read() sur un coffre inexistant rend `absent`, jamais une erreur", async () => {
    await withTempVault(async (location) => {
      const store = identityStore<{ a: number }>(location);
      const result = await store.read();
      assert.deepEqual(result, { status: "absent" });
    });
  });

  test("write() puis read() restitue exactement la valeur écrite", async () => {
    await withTempVault(async (location) => {
      const store = identityStore<{ a: number; b: string }>(location);
      const written = await store.write({ a: 1, b: "x" });
      assert.equal(written.status, "written");

      const read = await store.read();
      assert.deepEqual(read, { status: "loaded", value: { a: 1, b: "x" } });
    });
  });

  test("coffre présent mais clé disparue -> key_missing, jamais confondu avec `absent`", async () => {
    await withTempVault(async (location) => {
      const store = identityStore<{ a: number }>(location);
      await store.write({ a: 1 });
      await rm(location.keyPath);

      const result = await store.read();
      assert.equal(result.status, "error");
      if (result.status !== "error") return;
      assert.equal(result.kind, "key_missing");
    });
  });

  test("coffre illisible (JSON tronqué) -> error, jamais confondu avec `absent`", async () => {
    await withTempVault(async (location) => {
      const store = identityStore<{ a: number }>(location);
      await store.write({ a: 1 });
      await writeFile(location.configPath, "{ceci n'est pas du JSON", "utf8");

      const result = await store.read();
      assert.equal(result.status, "error");
      if (result.status !== "error") return;
      assert.equal(result.kind, "corrupted");
    });
  });

  test("encode() qui renvoie une Promise est refusé — aucun fichier n'est créé", async () => {
    await withTempVault(async (location) => {
      const options: EncryptedStoreOptions<{ a: number }> = {
        decode: (document) => ({ ok: true, value: document as { a: number } }),
        encode: (value) => Promise.resolve(value),
        location,
      };
      const store = createEncryptedStore(options);

      const result = await store.write({ a: 1 });

      assert.equal(result.status, "error");
      if (result.status === "error") assert.equal(result.kind, "invalid_payload");
      // Le répertoire temporaire existe déjà (créé par `withTempVault`, indépendamment du
      // magasin) : ce qui compte est qu'`isThenable`, vérifié AVANT `ensureDirectory`, a
      // empêché toute écriture — le répertoire reste donc VIDE.
      const entries = await readdir(location.directory);
      assert.deepEqual(entries, []);
    });
  });

  test("un Secret non déballé refuse l'écriture — le COFFRE n'est jamais créé", async () => {
    await withTempVault(async (location) => {
      const store = createEncryptedStore<{ apiToken: Secret }>({
        decode: (document) => ({ ok: true, value: document as { apiToken: Secret } }),
        encode: (value) => value,
        location,
      });
      const secret = createSecret("figd_jamais-sur-le-disque-888");

      const result = await store.write({ apiToken: secret });

      assert.equal(result.status, "error");
      if (result.status === "error") assert.equal(result.kind, "invalid_payload");
      // Le coffre (`config.enc`) ne doit jamais exister : c'est lui qui aurait porté le
      // masque à la place du jeton. `master.key` peut, lui, avoir été créé par
      // `loadOrCreateKey` avant l'inspection du document (ordre interne de
      // `writeInternal` : la clé est préparée avant `encryptDocument`) — une clé seule,
      // sans coffre, ne contient aucun jeton et n'est donc pas la fuite que l'invariant
      // interdit.
      await assert.rejects(() => readFile(location.configPath));
    });
  });

  test("decode() qui refuse le contenu -> invalid_content, message affiché tel quel", async () => {
    await withTempVault(async (location) => {
      const writer = identityStore<{ a: number }>(location);
      await writer.write({ a: 1 });

      const reader = createEncryptedStore<{ a: number }>({
        decode: () => ({ ok: false, message: "schéma de configuration non reconnu" }),
        encode: (value) => value,
        location,
      });

      const result = await reader.read();
      assert.equal(result.status, "error");
      if (result.status !== "error") return;
      assert.equal(result.kind, "invalid_content");
      assert.equal(result.message, "schéma de configuration non reconnu");
    });
  });

  test("decode() qui lève -> invalid_content générique, jamais un crash ni l'exception d'origine", async () => {
    await withTempVault(async (location) => {
      const writer = identityStore<{ a: number }>(location);
      await writer.write({ a: 1 });

      const reader = createEncryptedStore<{ a: number }>({
        decode: () => {
          throw new Error("jeton-1234-ne-doit-jamais-ressortir");
        },
        encode: (value) => value,
        location,
      });

      const result = await reader.read();
      assert.equal(result.status, "error");
      if (result.status !== "error") return;
      assert.equal(result.kind, "invalid_content");
      assert.equal(result.message.includes("jeton-1234-ne-doit-jamais-ressortir"), false);
    });
  });

  test("update() sérialise des écritures concurrentes sans en perdre aucune", async () => {
    await withTempVault(async (location) => {
      const store = createEncryptedStore<{ count: number; seen: number[] }>({
        decode: (document) => ({ ok: true, value: document as { count: number; seen: number[] } }),
        encode: (value) => value,
        location,
      });

      const indices = Array.from({ length: 20 }, (_, index) => index);
      await Promise.all(
        indices.map((index) =>
          store.update((current) => {
            const base = current ?? { count: 0, seen: [] };
            return { count: base.count + 1, seen: [...base.seen, index] };
          }),
        ),
      );

      const result = await store.read();
      assert.equal(result.status, "loaded");
      if (result.status !== "loaded") return;
      assert.equal(result.value.count, 20);
      assert.equal(new Set(result.value.seen).size, 20);
    });
  });

  test("update() sur un coffre illisible interrompt la mise à jour : rien n'est écrasé", async () => {
    await withTempVault(async (location) => {
      const writer = identityStore<{ a: number }>(location);
      await writer.write({ a: 1 });
      await writeFile(location.configPath, "{corrompu", "utf8");

      const store = identityStore<{ a: number }>(location);
      const result = await store.update((current) => ({ a: (current?.a ?? 0) + 1 }));

      assert.equal(result.status, "error");
      const raw = await readFile(location.configPath, "utf8");
      assert.equal(raw, "{corrompu");
    });
  });

  test("update() au premier lancement (coffre absent) reçoit `undefined`", async () => {
    await withTempVault(async (location) => {
      const store = createEncryptedStore<{ initialized: boolean }>({
        decode: (document) => ({ ok: true, value: document as { initialized: boolean } }),
        encode: (value) => value,
        location,
      });

      let receivedCurrent: unknown = "jamais-appele";
      await store.update((current) => {
        receivedCurrent = current;
        return { initialized: true };
      });

      assert.equal(receivedCurrent, undefined);
    });
  });
});

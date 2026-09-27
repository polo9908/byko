/**
 * Cadre de messagerie native de Chrome (voir docs/ipc/browser-automation.md §4.2) :
 * un entier 32 bits non signé en little-endian donnant la taille du corps, puis
 * le corps JSON en UTF-8.
 *
 * `stdout` du helper porte ce cadre et rien d'autre.
 */

/** Chrome refuse les messages de plus de 1 Mo dans le sens hôte → navigateur. */
export const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024

export function encodeNativeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8")
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32LE(body.length, 0)
  return Buffer.concat([header, body])
}

/** Décodeur incrémental : Chrome ne garantit pas qu'un message arrive d'un seul bloc. */
export class NativeMessageDecoder {
  private buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const messages: unknown[] = []
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (length > MAX_NATIVE_MESSAGE_BYTES) {
        throw new Error(`Message natif trop long (${length} octets).`)
      }
      if (this.buffer.length < 4 + length) break
      const body = this.buffer.subarray(4, 4 + length).toString("utf8")
      this.buffer = this.buffer.subarray(4 + length)
      messages.push(JSON.parse(body))
    }
    return messages
  }
}

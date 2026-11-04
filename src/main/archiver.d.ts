// Minimal typings for archiver 8 (ESM, class-based). The DefinitelyTyped package describes the old factory API.
declare module 'archiver' {
  import type { Readable } from 'node:stream'
  export interface ZipEntryData {
    name: string
    /** Store without compression (for media that is already compressed). */
    store?: boolean
    date?: Date
    mode?: number
  }
  export interface ArchiverOptions {
    zlib?: { level?: number }
    store?: boolean
  }
  export class Archiver extends Readable {
    constructor(options?: ArchiverOptions)
    file(filepath: string, data: ZipEntryData): this
    directory(dirpath: string, destpath: string | false): this
    finalize(): Promise<void>
  }
  export class ZipArchive extends Archiver {}
  export class TarArchive extends Archiver {}
}

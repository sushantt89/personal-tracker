/* eslint-disable @typescript-eslint/no-explicit-any */
/** Minimal in-memory stand-in for the Calendar and Drive APIs used by the app. */
export function createFakeGoogle() {
  const events = new Map<string, any>();
  const files = new Map<string, any>();
  let seq = 0;
  const id = (p: string) => `${p}${++seq}`;
  const notFound = () => Object.assign(new Error('Not Found'), { code: 404 });
  let failWith: any = null;
  const userDeleted: any[] = [];
  const later = () => new Date(Date.now() + 60000).toISOString();
  const maybeFail = () => { if (failWith) throw failWith; };

  const calendar = {
    events: {
      insert: async ({ requestBody }: any) => { maybeFail(); const e = { ...requestBody, id: id('evt'), status: 'confirmed', updated: new Date().toISOString() }; events.set(e.id, e); return { data: e }; },
      update: async ({ eventId, requestBody }: any) => { maybeFail(); if (!events.has(eventId)) throw notFound(); const e = { ...requestBody, id: eventId, status: 'confirmed', updated: new Date().toISOString() }; events.set(eventId, e); return { data: e }; },
      delete: async ({ eventId }: any) => { maybeFail(); if (!events.delete(eventId)) throw notFound(); return { data: {} }; },
      list: async ({ privateExtendedProperty, updatedMin, showDeleted, timeMin, timeMax }: any) => {
        maybeFail();
        if (!privateExtendedProperty) {
          // Plain listing of a time window, as used to show the person's own Google events
          const at = (e: any, k: 'start' | 'end') => e[k]?.dateTime ?? `${e[k]?.date}T00:00:00Z`;
          const inWindow = [...events.values()].filter((e) => (!timeMax || at(e, 'start') < timeMax) && (!timeMin || at(e, 'end') > timeMin));
          return { data: { items: inWindow.sort((a, b) => at(a, 'start').localeCompare(at(b, 'start'))) } };
        }
        const [k, v] = String(privateExtendedProperty?.[0] ?? '').split('=');
        const live = [...events.values()].filter((e) => e.extendedProperties?.private?.[k] === v && (!updatedMin || e.updated >= updatedMin));
        return { data: { items: showDeleted ? [...live, ...userDeleted.filter((e) => e.extendedProperties?.private?.[k] === v)] : live } };
      },
    },
  };

  const parse = (q: string) => ({
    name: /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'"),
    parent: /'([^']+)' in parents/.exec(q)?.[1],
    folder: q.includes("mimeType='application/vnd.google-apps.folder'"),
    sha: /value='([a-f0-9]+)'/.exec(q)?.[1],
  });
  const sent: string[] = [];
  const readAll = async (s: AsyncIterable<Buffer>) => { const parts: Buffer[] = []; for await (const c of s) parts.push(Buffer.from(c)); return Buffer.concat(parts); };
  const drive = {
    files: {
      get: async ({ fileId, alt }: any) => { maybeFail(); const f = files.get(fileId); if (!f) throw notFound(); if (alt === 'media') { const b: Buffer = f.content ?? Buffer.alloc(0); return { data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; } return { data: { id: f.id, trashed: false } }; },
      list: async ({ q }: any) => {
        maybeFail();
        const c = parse(q);
        const out = [...files.values()].filter((f) => (!c.name || f.name === c.name) && (!c.parent || f.parents?.[0] === c.parent) && (!c.folder || f.mimeType === 'application/vnd.google-apps.folder') && (!c.sha || f.appProperties?.sha256 === c.sha));
        return { data: { files: out.map((f) => ({ id: f.id, webViewLink: `https://drive.example/${f.id}` })) } };
      },
      create: async ({ requestBody, media }: any) => {
        maybeFail();
        const f = { ...requestBody, id: id('file'), versions: media ? 1 : 0, content: media ? await readAll(media.body) : undefined };
        files.set(f.id, f);
        return { data: { id: f.id, webViewLink: `https://drive.example/${f.id}` } };
      },
      update: async ({ fileId, requestBody, media }: any) => {
        maybeFail();
        const f = files.get(fileId); if (!f) throw notFound();
        Object.assign(f, requestBody, { versions: f.versions + 1 }, media ? { content: await readAll(media.body) } : {});
        return { data: { id: f.id, webViewLink: `https://drive.example/${f.id}` } };
      },
    },
  };

  const pathOf = (f: any): string => {
    const parts = [f.name];
    let p = f.parents?.[0];
    while (p && p !== 'root') { const parent = files.get(p); if (!parent) break; parts.unshift(parent.name); p = parent.parents?.[0]; }
    return parts.join('/');
  };

  return {
    apis: { calendar, drive, sendMail: async (raw: string) => { maybeFail(); sent.push(Buffer.from(raw, 'base64url').toString('utf8')); } } as any,
    events, files, sent,
    uploaded: () => [...files.values()].filter((f) => f.mimeType !== 'application/vnd.google-apps.folder').map((f) => ({ ...f, path: pathOf(f) })),
    folders: () => [...files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder').map(pathOf),
    /** Simulate the person adding their own event in the Google Calendar app. */
    userCreates: (event: any) => { const e = { ...event, id: id('own'), status: 'confirmed', htmlLink: 'https://calendar.example/event', updated: new Date().toISOString() }; events.set(e.id, e); return e.id as string; },
    /** Simulate the person editing or deleting an event in the Google Calendar app. */
    userEdits: (eventId: string, patch: any) => { events.set(eventId, { ...events.get(eventId), ...patch, updated: later() }); },
    userDeletes: (eventId: string) => { const e = events.get(eventId); events.delete(eventId); userDeleted.push({ ...e, status: 'cancelled', updated: later() }); },
    failNext: (e: any) => { failWith = e; },
    clearFail: () => { failWith = null; },
  };
}

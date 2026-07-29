import { ambToNostr } from '../../src/converters/ambToNostr';
import { nostrToAmb } from '../../src/converters/nostrToAmb';

describe('EKW ext round-trip', () => {
  const resource: any = {
    '@context': ['https://w3id.org/kim/amb/context.jsonld'],
    id: 'https://example.org/material/42',
    type: ['LearningResource'],
    name: 'Schöpfung',
    description: 'Eine Einheit',
    ext: {
      ekw: {
        gradeLevel: [
          { id: 'https://example.org/grade/5', type: 'Concept', prefLabel: { de: 'Klasse 5' } },
          { id: 'https://example.org/grade/6', type: 'Concept', prefLabel: { de: 'Klasse 6' } },
        ],
        bibleReference: ['Gen 1', 'Ps 104'],
      },
      // Form-emitted ext uses the form's bare d-tag as the namespace. The
      // 30168 coordinate does not belong in <ns> — the form is identified by
      // the resource's ["a", "30168:<pub>:<d>", …, "form"] back-ref.
      'reli-form': {
        fach: [{ id: 'https://example.org/fach/reli', type: 'Concept', prefLabel: { de: 'Religion' } }],
      },
      // Sub-vocabularies are their own namespace, not a colon inside <facet>.
      'org.edufeed.ekw.konfi': {
        zielgruppen: [{ id: 'https://example.org/zg/1', type: 'Concept', prefLabel: { de: 'Konfis' } }],
        plainLanguage: ['Leichte Sprache'],
      },
    },
  };

  test('ext survives AMB -> Nostr -> AMB', () => {
    const fwd = ambToNostr(resource, { pubkey: 'a'.repeat(64) });
    expect(fwd.success).toBe(true);
    const back = nostrToAmb(fwd.data!);
    expect(back.success).toBe(true);
    const ext = back.data!.ext!;
    expect(ext.ekw.gradeLevel).toEqual(resource.ext.ekw.gradeLevel);
    expect(ext.ekw.bibleReference).toEqual(['Gen 1', 'Ps 104']);
    expect(ext['reli-form'].fach).toEqual(resource.ext['reli-form'].fach);
    expect(ext['org.edufeed.ekw.konfi']).toEqual(resource.ext['org.edufeed.ekw.konfi']);
  });
});

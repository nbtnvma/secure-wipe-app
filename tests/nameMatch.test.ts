import { describe, expect, it } from 'vitest';
import { isPublisherName, matchName, nameVariants, normalizeName } from '../src/main/services/apps/nameMatch';

describe('normalizeName', () => {
  it('strips versions, architecture and punctuation but keeps +', () => {
    expect(normalizeName('Notepad++ (64-bit x64)')).toBe('notepad++');
    expect(normalizeName('7-Zip 23.01 (x64)')).toBe('7zip');
    expect(normalizeName('VLC media player')).toBe('vlcmediaplayer');
    expect(normalizeName('Microsoft Visual C++ 2015-2022 Redistributable')).toContain('visualc++');
  });
});

describe('nameVariants', () => {
  it('adds the name without the publisher prefix', () => {
    expect(nameVariants('Google Chrome', 'Google LLC')).toEqual(expect.arrayContaining(['googlechrome', 'chrome']));
  });
  it('never yields shared vendor names', () => {
    expect(nameVariants('Python 3.12.1', 'Python Software Foundation')).not.toContain('python');
    expect(nameVariants('Adobe', 'Adobe')).toEqual([]);
  });
});

describe('matchName', () => {
  const v = nameVariants('Notepad++', 'Notepad++ Team');
  it('matches the exact product folder with high confidence', () => {
    expect(matchName('Notepad++', v)).toBe('exact');
  });
  it('does not match unrelated or shared folders', () => {
    expect(matchName('Microsoft', v)).toBeNull();
    expect(matchName('Notes', v)).toBeNull();
    expect(matchName('Temp', v)).toBeNull();
  });
  it('treats close prefixes as partial (medium confidence)', () => {
    const obs = nameVariants('OBS Studio', 'OBS Project');
    expect(matchName('obs-studio', obs)).toBe('exact');
    expect(matchName('obsstudio64', obs)).toBe('partial');
    // too different in length → no match at all
    expect(matchName('obsstudiopluginsmanager', obs)).toBeNull();
  });
  it('v1 regression: publisher substring must not match other products', () => {
    const acrobat = nameVariants('Adobe Acrobat Reader', 'Adobe Inc.');
    expect(matchName('Adobe Photoshop 2024', acrobat)).toBeNull();
    expect(matchName('Adobe', acrobat)).toBeNull();
  });
});

describe('isPublisherName', () => {
  it('recognises vendor container folders', () => {
    expect(isPublisherName('Google', 'Google LLC')).toBe(true);
    expect(isPublisherName('Mozilla', 'Mozilla Corporation')).toBe(true);
    expect(isPublisherName('Chrome', 'Google LLC')).toBe(false);
  });
});

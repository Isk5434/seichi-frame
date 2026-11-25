const editions = new Map([
  ['T535kqz3mgw', '全国編'],
  ['UrpZQoMkLSk', '北海道・東北編'],
  ['uqmphKHPabI', '関東編'],
  ['fprIO2SVTsU', '中部編'],
  ['mRRFEOSx8Oo', '近畿編'],
  ['Kmr-8C2sazI', '中国・四国編'],
  ['8Wrs_DUo6GI', '九州・沖縄編'],
]);

function parseTimes(text) {
  const times = text.replace(/https?:\/\/\S+/g, ' ').matchAll(
    /(?<!\d)(?:(\d{1,2}):(\d{2})|(0)\.(\d{2})(?=秒)|(\d{1,2})分\s*(\d{1,2})[.]?秒|(\d{1,3})秒)/g,
  );
  return [...new Set([...times].map(([, minutes, seconds, zero, dotted, jpMinutes, jpSeconds, jpOnly]) =>
    Number(minutes ?? zero ?? jpMinutes ?? 0) * 60 + Number(seconds ?? dotted ?? jpSeconds ?? jpOnly)))];
}

function urlTime(url) {
  const value = url.searchParams.get('t') || url.searchParams.get('start') || url.hash.match(/^#t=(.+)$/)?.[1];
  if (!value) return null;
  if (/^\d+s?$/.test(value)) return Number.parseInt(value, 10);
  const parts = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return parts ? Number(parts[1] || 0) * 3600 + Number(parts[2] || 0) * 60 + Number(parts[3] || 0) : null;
}

export function readPv(spot) {
  const description = spot.description.normalize('NFKC');
  const links = [...description.matchAll(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?|youtu\.be\/)[a-z0-9_?&=.#%+;\/-]+/gi)];
  const videos = links.flatMap((match, index) => {
    const url = new URL(match[0].replaceAll('&amp;', '&'));
    const id = url.searchParams.get('v') || url.pathname.slice(1);
    if (!/^[\w-]{11}$/.test(id)) return [];
    const end = links[index + 1]?.index ?? description.length;
    const after = description.slice(match.index + match[0].length, end);
    const before = links.length === 1 ? description.slice(0, match.index) : '';
    const times = parseTimes(before + ' ' + after);
    const start = urlTime(url);
    return [{ id, edition: editions.get(id) || 'PV', times: times.length ? times : start === null ? [] : [start] }];
  });
  const labels = [...new Set(videos.map(video => video.edition))];
  if (!labels.length) {
    const namedEditions = [...editions.values()].filter(edition => {
      const context = spot.name + ' ' + description;
      return context.includes(edition) || context.includes(edition.replace('編', '篇'));
    });
    labels.push(...namedEditions);
  }
  return { videos, labels };
}

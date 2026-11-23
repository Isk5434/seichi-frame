"""Import the public Google My Maps KML without executing description HTML."""
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
MAP_ID = '1OwqKxXjbbbXAVZwbBNazhsavcs1ZWgpQ'
SOURCE_URL = f'https://www.google.com/maps/d/viewer?mid={MAP_ID}'
NS = {'k': 'http://www.opengis.net/kml/2.2'}


class DescriptionParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text = []
        self.images = []
        self.suppress = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.suppress += 1
        if tag in ('br', 'p', 'div'):
            self.text.append('\n')
        if tag == 'img':
            url = dict(attrs).get('src', '')
            if url.startswith('https://'):
                self.images.append(url)

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.suppress = max(0, self.suppress - 1)

    def handle_data(self, data):
        if not self.suppress:
            self.text.append(data)


def parse_kml(content):
    root = ET.fromstring(content)
    spots = []
    for folder in root.findall('.//k:Folder', NS):
        layer = folder.findtext('k:name', default='', namespaces=NS)
        for pin in folder.findall('k:Placemark', NS):
            coord = pin.findtext('k:Point/k:coordinates', namespaces=NS)
            if not coord:
                continue
            lng, lat = map(float, coord.strip().split(',')[:2])
            if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
                continue
            name = pin.findtext('k:name', default='名称未設定', namespaces=NS)
            desc = DescriptionParser()
            desc.feed(pin.findtext('k:description', default='', namespaces=NS))
            media = pin.findtext("k:ExtendedData/k:Data[@name='gx_media_links']/k:value", default='', namespaces=NS)
            photos = list(dict.fromkeys(desc.images + [u for u in media.split() if u.startswith('https://')]))
            key = f'{layer}|{name}|{lat}|{lng}'
            spots.append({'id': hashlib.sha256(key.encode()).hexdigest()[:16], 'name': name,
                          'layer': layer, 'lat': lat, 'lng': lng,
                          'description': '\n'.join(line.strip() for line in ''.join(desc.text).splitlines() if line.strip()),
                          'photos': photos})
    return {'title': root.findtext('k:Document/k:name', default='聖地巡礼マップ', namespaces=NS),
            'sourceUrl': SOURCE_URL, 'importedAt': datetime.now(timezone.utc).isoformat(), 'spots': spots}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    source = ROOT / 'data/source.kml'
    if args.refresh:
        request = urllib.request.Request(f'https://www.google.com/maps/d/kml?mid={MAP_ID}&forcekml=1')
        content = urllib.request.urlopen(request, timeout=60).read()
        parse_kml(content)  # Validate before replacing the snapshot.
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(content)
    result = parse_kml(source.read_bytes())
    target = ROOT / 'legacy/data/spots.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        existing = {spot['id']: spot for spot in json.loads(target.read_text(encoding='utf-8'))['spots']}
        for spot in result['spots']:
            previous = existing.get(spot['id'], {})
            for field in ('photoAssets', 'prefecture', 'city', 'location'):
                if field in previous:
                    spot[field] = previous[field]
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'spots': len(result['spots']), 'withPhotos': sum(bool(s['photos']) for s in result['spots']),
                      'photos': sum(len(s['photos']) for s in result['spots'])}))

import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('import_map', ROOT / 'scripts/import_map.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImportTests(unittest.TestCase):
    def test_real_map_preserves_spots_and_photos(self):
        data = module.parse_kml((ROOT / 'data/source.kml').read_bytes())
        self.assertEqual(len(data['spots']), 167)
        self.assertEqual(sum(bool(s['photos']) for s in data['spots']), 163)
        self.assertEqual(sum(len(s['photos']) for s in data['spots']), 368)
        self.assertEqual(len({s['id'] for s in data['spots']}), 167)
        shipped = json.loads((ROOT / 'legacy/data/spots.json').read_text(encoding='utf8'))
        enriched = {'photoAssets', 'prefecture', 'city', 'location'}
        self.assertEqual(data['spots'], [{k: v for k, v in spot.items() if k not in enriched} for spot in shipped['spots']])

    def test_description_is_plain_text_and_images_are_deduplicated(self):
        xml = '''<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>Layer</name>
        <Placemark><name>Spot</name><description><![CDATA[hello<br>world<script>bad()</script><img src="https://example.com/a.jpg"><img src="javascript:bad()">]]></description>
        <ExtendedData><Data name="gx_media_links"><value>https://example.com/a.jpg https://example.com/b.jpg</value></Data></ExtendedData>
        <Point><coordinates>139,35,0</coordinates></Point></Placemark>
        <Placemark><name>Bad coordinate</name><Point><coordinates>139,95,0</coordinates></Point></Placemark>
        <Placemark><name>Line only</name></Placemark></Folder></Document></kml>'''
        result = module.parse_kml(xml)['spots']
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['description'], 'hello\nworld')
        self.assertEqual(result[0]['photos'], ['https://example.com/a.jpg', 'https://example.com/b.jpg'])
        self.assertEqual(result[0]['lat'], 35)
        self.assertEqual(result[0]['id'], module.parse_kml(xml)['spots'][0]['id'])


if __name__ == '__main__':
    unittest.main()

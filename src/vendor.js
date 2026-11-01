// بسته‌ی کتابخانه‌ها: توسط esbuild به www/vendor.js تبدیل می‌شود و روی window.Lib قرار می‌گیرد.
import proj4 from 'proj4';
import * as togeojson from '@tmcw/togeojson';
import shp from 'shpjs';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import shpwrite from '@mapbox/shp-write';
import { CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

window.Lib = { proj4, togeojson, shp, JSZip, XLSX, shpwrite, Http: CapacitorHttp, Filesystem, Directory, Encoding, Share, App, VectorTile, PbfReader };

import { AssetType, defineAssets } from '@iwsdk/core';
import { dayTray } from './scene-assets/day-tray.scene-asset.js';
import { doneJar } from './scene-assets/done-jar.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  'day-tray': dayTray,
  'done-jar': doneJar,
  'planner-panel': {
    url: publicAssetUrl('ui/planner.uikitml'),
    type: AssetType.UIKitML,
    name: 'Planner Panel',
  },
});

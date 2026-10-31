import { Platform, Share } from 'react-native';

import { floorExportJson, type StoredFloor } from '@/db/floors';
import type { EngineSnapshot } from '@/engine/types';

/** The walk in progress, shaped like a saved floor so it exports the same JSON. */
export function liveWalkFloor(snapshot: EngineSnapshot, now = Date.now()): StoredFloor {
  const stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
  return {
    id: 'live',
    buildingId: 'live',
    buildingName: 'Live walk',
    name: stamp,
    stepCount: snapshot.stepCount,
    heading: snapshot.heading,
    pinCount: snapshot.pins.length,
    pointCount: snapshot.correctedPath.length,
    createdAt: now,
    snapshot,
  };
}

/** Share one floor as JSON. Web downloads (and copies) because SQLite is off there. */
export async function shareStoredFloor(floor: StoredFloor): Promise<string> {
  const json = floorExportJson(floor);
  const title = `${floor.buildingName} / ${floor.name}`;

  if (Platform.OS === 'web') return shareOnWeb(title, fileName(floor), json);

  const result = await Share.share({ title, message: json });
  if (result.action === Share.dismissedAction) return 'Share canceled.';
  return `Shared ${title}.`;
}

async function shareOnWeb(title: string, filename: string, json: string): Promise<string> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const copied = await copyText(nav, json);
  const downloaded = downloadJson(filename, json);
  if (downloaded && copied) return `Exported ${title}. JSON downloaded and copied.`;
  if (downloaded) return `Exported ${title}. JSON downloaded.`;
  if (copied) return `Copied ${title} JSON.`;

  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ title, text: json });
      return `Shared ${title}.`;
    } catch (error) {
      if (isAbort(error)) return 'Share canceled.';
    }
  }
  return 'Export is not available in this browser.';
}

async function copyText(nav: Navigator | undefined, json: string): Promise<boolean> {
  if (!nav?.clipboard?.writeText) return false;
  try {
    await nav.clipboard.writeText(json);
    return true;
  } catch {
    return false;
  }
}

function downloadJson(filename: string, json: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return false;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}

function fileName(floor: StoredFloor): string {
  return `${slug(floor.buildingName)}-${slug(floor.name)}.json`;
}

function slug(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'floor';
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

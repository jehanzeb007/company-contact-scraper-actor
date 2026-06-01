import {
  additionalInfoLabelFromRaw,
  isCleanAdditionalInfoLabel,
  norm,
  normalizeAdditionalInfo,
  sanitizePlaceDescription,
} from './textHeuristics.js';

export const ABOUT_SECTION_HINTS = [
  'Accessibility',
  'Amenities',
  'Atmosphere',
  'Children',
  'Crowd',
  'Dining options',
  'From the business',
  'Getting here',
  'Health and safety',
  'Highlights',
  'Offerings',
  'Parking',
  'Payments',
  'Planning',
  'Popular for',
  'Service options',
  'Activities',
];

/** Extract about sections from nested preview/place JSON (via `walkArrays`). */
export function extractAboutFromPreviewData(data, walkArrays) {
  const additionalInfo = {};
  let description = null;
  const headerSet = new Set(ABOUT_SECTION_HINTS.map((h) => h.toLowerCase()));

  walkArrays(data, (arr) => {
    if (!arr.length) return;

    let title = null;
    let titleIdx = -1;
    for (let i = 0; i < Math.min(arr.length, 5); i++) {
      if (typeof arr[i] !== 'string') continue;
      const candidate = norm(arr[i]);
      if (!candidate || candidate.length > 80) continue;
      if (headerSet.has(candidate.toLowerCase())) {
        title = candidate;
        titleIdx = i;
        break;
      }
    }
    if (!title) return;

    if (title.toLowerCase() === 'from the business' || title.toLowerCase() === 'about') {
      for (let i = 0; i < arr.length; i++) {
        if (i === titleIdx) continue;
        const collectDesc = (node) => {
          if (typeof node === 'string' && node.length > 40 && node.length < 5000) {
            const candidate = sanitizePlaceDescription(node);
            if (candidate) {
              description = candidate;
              return true;
            }
          }
          if (Array.isArray(node)) {
            for (const child of node) {
              if (collectDesc(child)) return true;
            }
          }
          return false;
        };
        if (collectDesc(arr[i])) return;
      }
      return;
    }

    if (!headerSet.has(title.toLowerCase())) return;

    const items = [];
    const collect = (node) => {
      if (typeof node === 'string') {
        const label = additionalInfoLabelFromRaw(node);
        if (label && isCleanAdditionalInfoLabel(label, title) && !/^https?:\/\//i.test(label)) {
          items.push(label);
        }
      } else if (Array.isArray(node)) {
        for (const child of node) collect(child);
      }
    };
    for (let i = 0; i < arr.length; i++) {
      if (i !== titleIdx) collect(arr[i]);
    }
    const existing = additionalInfo[title] || [];
    const unique = [...new Set([...existing, ...items])];
    if (unique.length) additionalInfo[title] = unique;
  });

  return {
    description,
    additionalInfo: normalizeAdditionalInfo(additionalInfo),
  };
}

const SOP_DB_NAME = "sop-recorder";
const SOP_DB_VERSION = 1;
const SCREENSHOT_STORE = "screenshots";

function openSopDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SOP_DB_NAME, SOP_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SCREENSHOT_STORE)) {
        db.createObjectStore(SCREENSHOT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putScreenshotRecord(record) {
  const db = await openSopDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCREENSHOT_STORE, "readwrite");
    tx.objectStore(SCREENSHOT_STORE).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

async function getScreenshotRecord(id) {
  if (!id) return null;
  const db = await openSopDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCREENSHOT_STORE, "readonly");
    const request = tx.objectStore(SCREENSHOT_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function getScreenshotRecords(ids) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const entries = await Promise.all(uniqueIds.map(async (id) => [id, await getScreenshotRecord(id)]));
  return Object.fromEntries(entries);
}

async function deleteScreenshotRecords(ids) {
  const db = await openSopDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCREENSHOT_STORE, "readwrite");
    const store = tx.objectStore(SCREENSHOT_STORE);
    ids.filter(Boolean).forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

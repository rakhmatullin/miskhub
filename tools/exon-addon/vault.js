const ExonVault = (() => {
  const folderName = "MISKHub Экзон";
  const fileName = "вход.json";
  const encoder = new TextEncoder();
  const aad = encoder.encode("miskhub-exon-vault-v1");

  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open("miskhub-exon", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("local");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  async function local(key, value) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("local", value === undefined ? "readonly" : "readwrite");
      const store = tx.objectStore("local");
      const request = value === undefined ? store.get(key) : store.put(value, key);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
  }

  const lock = task => navigator.locks.request("miskhub-exon-vault", task);
  const encode = bytes => btoa(String.fromCharCode(...bytes));
  const decode = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

  async function read(dir) {
    let file;
    try {
      file = await dir.getFileHandle(fileName);
    } catch (error) {
      if (error.name === "NotFoundError") return null;
      throw error;
    }
    try {
      const {schemaVersion, nonce, ciphertext} = JSON.parse(await (await file.getFile()).text());
      if (schemaVersion !== 1) throw new Error("Неизвестная версия файла.");
      const key = await local("key");
      if (!key) throw new Error("Для этого файла нужен исходный профиль браузера.");
      const clear = await crypto.subtle.decrypt({name: "AES-GCM", iv: decode(nonce), additionalData: aad}, key, decode(ciphertext));
      const record = JSON.parse(new TextDecoder().decode(clear));
      if (typeof record.login !== "string" || typeof record.password !== "string" ||
          (record.remarksUrl !== undefined && typeof record.remarksUrl !== "string")) throw new Error();
      return record;
    } catch (error) {
      const details = error.message && (error.name === "Error") ? " " + error.message : "";
      throw new Error(`Не удалось прочитать «${fileName}».${details} Проверьте исходный профиль браузера или выберите другую папку.`);
    }
  }

  async function choose() {
    const parent = await window.showDirectoryPicker({id: "miskhub-exon", mode: "readwrite"});
    return lock(async () => {
      const dir = await parent.getDirectoryHandle(folderName, {create: true});
      const record = await read(dir);
      const location = {dir, label: parent.name + "/" + folderName};
      await local("folder", location);
      return {location, record};
    });
  }

  async function save(dir, credentials) {
    return lock(async () => {
      await read(dir);
      let key = await local("key");
      if (!key) {
        key = await crypto.subtle.generateKey({name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]);
        await local("key", key);
      }
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const value = encoder.encode(JSON.stringify(credentials));
      const encrypted = await crypto.subtle.encrypt({name: "AES-GCM", iv: nonce, additionalData: aad}, key, value);
      const file = await dir.getFileHandle(fileName, {create: true});
      const writer = await file.createWritable();
      try {
        await writer.write(JSON.stringify({schemaVersion: 1, nonce: encode(nonce), ciphertext: encode(new Uint8Array(encrypted))}, null, 2));
        await writer.close();
      } catch (error) {
        await writer.abort().catch(() => {});
        throw error;
      }
    });
  }

  return {choose, save, load: dir => lock(() => read(dir)), restore: () => local("folder")};
})();

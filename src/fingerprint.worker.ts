import SparkMD5 from "spark-md5";
self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const hash = new SparkMD5.ArrayBuffer();
    const file = event.data;
    for (let offset = 0; offset < file.size; offset += 2 * 1024 * 1024)
      hash.append(
        await file.slice(offset, offset + 2 * 1024 * 1024).arrayBuffer(),
      );
    self.postMessage({ md5: hash.end() });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};

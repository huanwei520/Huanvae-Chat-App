/**
 * 选图快照工具 —— 规避安卓 WebView 的「清空 input 后 file-backed Blob 失效」。
 *
 * 背景（真机实测根因，2026-09-14）：`<input type=file>` 在安卓 WebView 上返回的 File
 * 是**文件背衬（file-backed）**的 Blob。若在下游读取之前把 `input.value = ''`（常见写法，
 * 为支持重复选择同一文件），底层文件句柄随 input 一起被释放，于是：
 *   - `URL.createObjectURL(file)` 仍能拿到一个 blob: URL，
 *   - 但 `new Image().src = blobURL` 永远不触发 onload（naturalWidth=0），
 *   - `fetch(blobURL)` 直接 `TypeError: Failed to fetch`。
 * 表现即用户看到「头像裁剪确认后无反应/图片加载失败」——**安卓端完全无法设置头像**。
 *
 * 修法：拿到 File 后**先**把字节读进内存（`arrayBuffer()`），构造一个内存背衬的新 File
 * 交给下游；调用方再清空 input 就安全了。
 *
 * @module utils/pickedFile
 */

/** 读文件字节：优先 `Blob.arrayBuffer()`，环境不提供时回落 `FileReader`（jsdom/旧 WebView） */
function readBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  return new Promise<ArrayBuffer>((resolvePromise, rejectPromise) => {
    const reader = new FileReader();
    reader.onload = () => { resolvePromise(reader.result as ArrayBuffer); };
    reader.onerror = () => { rejectPromise(reader.error ?? new Error('read failed')); };
    reader.readAsArrayBuffer(file);
  });
}

/** 把选中的 File 复制成内存背衬的 File（读取失败时原样返回，交给下游报错） */
export async function snapshotPickedFile(file: File): Promise<File> {
  try {
    const buffer = await readBytes(file);
    return new File([buffer], file.name || 'picked', {
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
    });
  } catch {
    // 读不到字节（权限/已失效）时退回原对象，让既有错误分支继续负责提示
    return file;
  }
}

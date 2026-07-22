/* =========================================================
 * db.js - 브라우저 내장 DB(IndexedDB) 저장 계층
 *  · 목적: 앱(페이지) 기능이 바뀌거나 저장 키가 변경되어도
 *          데이터가 유실되지 않도록 localStorage와 별도로
 *          안정된 DB에 이중 저장합니다.
 *  · 계정별 슬롯: 'data:<ctx>' (ctx = 로그인 계정 해시)
 *    → 소유자/중개사 데이터가 서로 섞이지 않음
 *  · 스냅샷도 DB에 함께 보관해 용량 제한·유실 위험을 줄임
 * ========================================================= */
window.REMSDB = (function () {
  'use strict';

  var DB_NAME = 'rems-db';   // 이름은 앞으로 바꾸지 않는다 (데이터 영속성 보장)
  var DB_VER = 2;            // v2: 첨부파일(files) 저장소 추가
  var STORE = 'kv';
  var FILES = 'files';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB 미지원')); return; }
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(FILES)) {
          var fs = db.createObjectStore(FILES, { keyPath: 'id', autoIncrement: true });
          fs.createIndex('byProp', ['ctx', 'propId']);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function get(key) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var rq = tx.objectStore(STORE).get(key);
        rq.onsuccess = function () { resolve(rq.result == null ? null : rq.result); };
        rq.onerror = function () { reject(rq.error); };
      });
    }).catch(function () { return null; }); // DB 사용 불가 시 조용히 폴백
  }

  function set(key, value) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () { return false; });
  }

  /** 현재 로그인 컨텍스트(계정 해시). 없으면 'default' */
  function ctx() {
    try { return localStorage.getItem('rems_ctx') || 'default'; } catch (e) { return 'default'; }
  }

  /* ---------- 첨부파일 (물건별 계약·보증 서류) ---------- */

  function addFile(propId, file) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(FILES, 'readwrite');
        tx.objectStore(FILES).add({
          ctx: ctx(), propId: Number(propId),
          name: file.name, type: file.type, size: file.size,
          ts: Date.now(), blob: file,
        });
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  /** 해당 물건의 파일 메타 목록 (blob 제외) */
  function listFiles(propId) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var idx = db.transaction(FILES, 'readonly').objectStore(FILES).index('byProp');
        var rq = idx.getAll(IDBKeyRange.only([ctx(), Number(propId)]));
        rq.onsuccess = function () {
          resolve((rq.result || []).map(function (r) {
            return { id: r.id, name: r.name, type: r.type, size: r.size, ts: r.ts };
          }));
        };
        rq.onerror = function () { reject(rq.error); };
      });
    }).catch(function () { return []; });
  }

  function getFile(id) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var rq = db.transaction(FILES, 'readonly').objectStore(FILES).get(Number(id));
        rq.onsuccess = function () { resolve(rq.result || null); };
        rq.onerror = function () { reject(rq.error); };
      });
    }).catch(function () { return null; });
  }

  function deleteFile(id) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(FILES, 'readwrite');
        tx.objectStore(FILES).delete(Number(id));
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () { return false; });
  }

  return {
    get: get,
    set: set,
    ctx: ctx,
    dataKey: function () { return 'data:' + ctx(); },
    snapKey: function () { return 'snapshots:' + ctx(); },
    addFile: addFile,
    listFiles: listFiles,
    getFile: getFile,
    deleteFile: deleteFile,
  };
})();

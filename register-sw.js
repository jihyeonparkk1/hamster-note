// 오프라인에서도 열리도록 서비스 워커 등록 (보안 정책상 별도 파일)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

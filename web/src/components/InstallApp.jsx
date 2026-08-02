import { useEffect, useState } from "react";

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isHarmonyDevice() {
  return /harmonyos|huawei|honor/i.test(window.navigator.userAgent);
}

function isChromeBrowser() {
  const userAgent = window.navigator.userAgent;
  return /chrome|crios/i.test(userAgent) && !/edg|opr|huaweibrowser/i.test(userAgent);
}

function InstallIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v11m0 0 4-4m-4 4-4-4" />
      <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

export default function InstallApp() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [installed, setInstalled] = useState(isStandalone);
  const harmony = isHarmonyDevice();
  const chrome = isChromeBrowser();

  useEffect(() => {
    function capturePrompt(event) {
      event.preventDefault();
      setInstallPrompt(event);
    }
    function markInstalled() {
      setInstalled(true);
      setInstallPrompt(null);
      setGuideOpen(false);
    }
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  async function install() {
    if (!installPrompt) {
      setGuideOpen(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  }

  if (installed) return null;

  return (
    <>
      <button className="install-button" type="button" onClick={install} aria-label="添加 Meme Radar 到桌面">
        <InstallIcon />
        <span>{installPrompt ? "安装应用" : "桌面安装指引"}</span>
      </button>
      {guideOpen && (
        <div className="install-dialog-backdrop" role="presentation" onMouseDown={() => setGuideOpen(false)}>
          <section className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="install-app-mark" aria-hidden="true"><span /></div>
            <h2 id="install-title">添加 Meme Radar 到桌面</h2>
            {chrome ? (
              <>
                <p>当前使用 Chrome，请通过浏览器菜单完成：</p>
                <ol>
                  <li>点击 Chrome 右上角的 <strong>⋮</strong></li>
                  <li>选择 <strong>添加到主屏幕</strong>；满足 PWA 条件时会显示“安装应用”</li>
                  <li>确认名称后点击添加，桌面会生成雷达图标</li>
                </ol>
              </>
            ) : harmony ? (
              <>
                <p>当前是鸿蒙设备，请在华为浏览器中完成：</p>
                <ol>
                  <li>点击浏览器页面的 <strong>⋮ / 菜单</strong></li>
                  <li>选择 <strong>添加至桌面</strong>；部分版本显示“添加至 → 桌面”</li>
                  <li>确认名称后点击完成，桌面会生成雷达图标</li>
                </ol>
              </>
            ) : (
              <p>鸿蒙/华为浏览器请选择“菜单 → 添加至桌面”；其他浏览器请选择“安装应用”或“添加到主屏幕”。</p>
            )}
            {!window.isSecureContext && <p className="install-note">当前使用 IP + HTTP，系统会创建网页快捷方式；绑定 HTTPS 域名后可使用完整 PWA 安装模式。</p>}
            <button className="install-dialog-close" type="button" onClick={() => setGuideOpen(false)}>知道了</button>
          </section>
        </div>
      )}
    </>
  );
}

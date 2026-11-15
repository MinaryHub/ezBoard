import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import Icon from './Icon';

/**
 * 핀(패드)을 눌렀다 뗐을 때 그 자리에 뜨는 작은 메뉴.
 * 터치 화면(안드로이드)에는 Alt 키가 없으므로 연결 끊기를 여기서 한다.
 */
export default function PinMenu({ x, y, pin, net, onDisconnect, onClose }: {
  x: number; y: number; pin: string; net?: string; onDisconnect: () => void; onClose: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // 다른 곳을 누르면 닫는다 (메뉴 안은 제외)
    const onDown = (e: PointerEvent) => { if (!(e.target as Element).closest?.('.pin-menu')) onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // 화면 밖으로 나가지 않게
  const left = Math.min(Math.max(8, x + 12), window.innerWidth - 228);
  const top = Math.min(Math.max(8, y + 12), window.innerHeight - 120);

  return createPortal(
    <div className="pin-menu" style={{ left, top }} role="menu">
      <div className="pin-menu-head"><b>{pin}</b>{net ? <span> · {net}</span> : <span className="muted"> · {t('pin.unconnected')}</span>}</div>
      {net ? (
        <button className="danger" role="menuitem" onClick={() => { onDisconnect(); onClose(); }}>
          <Icon name="trash" size={14} />{t('pin.disconnect')}
        </button>
      ) : null}
      <div className="pin-menu-hint">{t('pin.dragHint')}</div>
    </div>,
    document.body,
  );
}

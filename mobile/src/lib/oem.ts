import * as Device from 'expo-device';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

/**
 * OEM battery-killer handling (§6). Stock Android honours the foreground
 * service contract; these skins do not — they kill the recorder mid-ride
 * unless the rider whitelists the app. First cohort rides exactly these
 * handsets, so this is a Phase 01 requirement, not polish.
 *
 * Approach copied from the delivery apps that live or die by this
 * (Blinkit/Zomato): explain, deep-link to the OEM screen when the activity
 * exists, walk through the steps when it doesn't. Warn, never gate.
 */

export type OemFamily = 'xiaomi' | 'vivo' | 'oppo' | 'oneplus' | 'huawei';

export function oemFamily(): OemFamily | null {
  if (Platform.OS !== 'android') return null;
  const m = `${Device.manufacturer ?? ''} ${Device.brand ?? ''}`.toLowerCase();
  if (/xiaomi|redmi|poco/.test(m)) return 'xiaomi';
  if (/vivo|iqoo/.test(m)) return 'vivo';
  if (/oppo|realme/.test(m)) return 'oppo';
  if (/oneplus/.test(m)) return 'oneplus';
  if (/huawei|honor/.test(m)) return 'huawei';
  return null;
}

export const OEM_COPY: Record<OemFamily, { skin: string; steps: string[] }> = {
  xiaomi: {
    skin: 'MIUI / HyperOS',
    steps: [
      'Open Security app → Autostart → allow TRACE',
      'Settings → Apps → TRACE → Battery saver → No restrictions',
      'Recent apps → long-press TRACE → lock (padlock icon)',
    ],
  },
  vivo: {
    skin: 'Funtouch OS',
    steps: [
      'iManager → App manager → Autostart → allow TRACE',
      'Settings → Battery → High background power consumption → allow TRACE',
    ],
  },
  oppo: {
    skin: 'ColorOS',
    steps: [
      'Settings → Apps → TRACE → Allow auto launch',
      'Settings → Battery → App battery management → TRACE → Allow background activity',
    ],
  },
  oneplus: {
    skin: 'OxygenOS',
    steps: [
      'Settings → Apps → TRACE → Battery usage → Unrestricted',
      'Settings → Battery → Advanced settings → turn OFF Optimized standby',
    ],
  },
  huawei: {
    skin: 'EMUI',
    steps: [
      'Phone Manager → App launch → TRACE → Manage manually → enable all three',
      'Settings → Battery → App launch → TRACE → allow',
    ],
  },
};

/** Known OEM whitelist activities, most specific first. Component names vary
 *  by skin version — every launch is a try, and failure falls through. */
const OEM_ACTIVITIES: Record<OemFamily, { pkg: string; cls: string }[]> = {
  xiaomi: [
    { pkg: 'com.miui.securitycenter', cls: 'com.miui.permcenter.autostart.AutoStartManagementActivity' },
  ],
  vivo: [
    { pkg: 'com.vivo.permissionmanager', cls: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity' },
    { pkg: 'com.iqoo.secure', cls: 'com.iqoo.secure.ui.phoneoptimize.BgStartUpManager' },
  ],
  oppo: [
    { pkg: 'com.coloros.safecenter', cls: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' },
    { pkg: 'com.coloros.safecenter', cls: 'com.coloros.safecenter.startupapp.StartupAppListActivity' },
  ],
  oneplus: [
    { pkg: 'com.oneplus.security', cls: 'com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity' },
  ],
  huawei: [
    { pkg: 'com.huawei.systemmanager', cls: 'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity' },
    { pkg: 'com.huawei.systemmanager', cls: 'com.huawei.systemmanager.optimize.process.ProtectActivity' },
  ],
};

/**
 * Open the most specific OEM screen that exists on this device.
 * Returns which tier worked: the OEM activity, the battery-optimization
 * list, or plain app settings — the walkthrough copy adapts to it.
 */
export async function openWhitelistSettings(
  family: OemFamily | null
): Promise<'oem' | 'battery' | 'app'> {
  if (Platform.OS !== 'android') return 'app';

  for (const a of family ? OEM_ACTIVITIES[family] : []) {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
        packageName: a.pkg,
        className: a.cls,
      });
      return 'oem';
    } catch {
      // skin version without this activity — fall through
    }
  }
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'
    );
    return 'battery';
  } catch {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
      { data: 'package:com.trace.app' }
    );
    return 'app';
  }
}

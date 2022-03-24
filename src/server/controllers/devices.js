import crypto from 'crypto';
import dirTree from 'directory-tree';
import log4js from 'log4js';
import sanitizeFactory from 'sanitize';
import { Op } from 'sequelize';

import {
  Accounts,
  Devices,
  Drives,
  DriveSegments,
} from '../../models';
import { readJWT, validateJWT } from './authentication';
import { getAccountFromId } from './users';

const logger = log4js.getLogger();
const sanitize = sanitizeFactory();

async function pairDevice(account, qrString) {
  if (qrString === undefined || qrString === null) {
    return { success: false, badQr: true };
  }
  // Legacy registrations encode QR data as "imei--serial--pairtoken"
  // Versions >= 0.8.3 uses only a pairtoken

  const qrCodeParts = qrString.split('--');
  let device;
  let pairJWT;

  if (qrString.indexOf('--') >= 0) {
    const [, serial, pairToken] = qrCodeParts;
    device = await Devices.findOne({ where: { serial } });
    pairJWT = pairToken;
  } else {
    const data = await readJWT(qrString);
    if (!data || !data.pair) {
      return { success: false, noPair: true };
    }
    device = await Devices.findOne({ where: { dongle_id: data.identity } });
    pairJWT = qrString;
  }

  if (device == null || !device.dataValues) {
    return { success: false, registered: false, noPair: true };
  }

  const decoded = await validateJWT(pairJWT, device.public_key);
  if (decoded == null || !decoded.pair) {
    return { success: false, badToken: true };
  }

  if (device.account_id !== 0) {
    return { success: false, alreadyPaired: true, dongle_id: device.dongle_id };
  }
  return pairDeviceToAccountId(device.dongle_id, account.id);
}

async function pairDeviceToAccountId(dongleId, accountId) {
  await Devices.update(
    { account_id: accountId },
    { where: { dongle_id: dongleId } },
  );

  const check = await Devices.findOne(
    { where: { dongle_id: dongleId, account_id: accountId } },
  );
  if (check.dataValues) {
    return {
      success: true, paired: true, dongle_id: dongleId, account_id: accountId,
    };
  }
  return { success: false, paired: false };
}

async function unpairDevice(dongleId, accountId) {
  const device = await Devices.getOne(
    { where: { account_id: accountId, dongle_id: dongleId } },
  );

  if (device && device.dataValues) {
    // TODO: check result?
    await Devices.update(
      { account_id: 0 },
      { where: { dongle_id: dongleId } },
    );
    return { success: true };
  }
  return { success: false, msg: 'BAD DONGLE', invalidDongle: true };
}

async function setDeviceNickname(account, dongleId, nickname) {
  const device = await Devices.getOne(
    { where: { account_id: account.id, dongle_id: dongleId } },
  );

  const cleanNickname = sanitize.value(nickname, 'string');

  if (device && device.dataValues) {
    await Devices.update(
      { nickname: cleanNickname },
      { where: { dongle_id: dongleId } },
    );
    return { success: true, data: { nickname: cleanNickname } };
  }
  return { success: false, msg: 'BAD DONGLE', invalidDongle: true };
}

async function getDevices(accountId) {
  return Devices.findAll({ where: { account_id: accountId } });
}

async function getDeviceFromDongleId(dongleId) {
  if (!dongleId) {
    return null;
  }

  const device = await Devices.findOne({ where: { dongle_id: dongleId } });
  if (!device || !device.dataValues) {
    return null;
  }
  return device.dataValues;
}

// TODO combine these redundant functions into one
async function getDeviceFromSerial(serial) {
  if (!serial) {
    return null;
  }

  const devices = await Devices.findOne({ where: { serial } });
  if (!devices || !devices.dataValues) {
    return null;
  }
  return devices.dataValues;
}

async function updateDevice(dongleId, data) {
  if (!dongleId) {
    return null;
  }
  return Devices.update(data, { where: { dongle_id: dongleId } });
}

async function setIgnoredUploads(dongleId, isIgnored) {
  await Accounts.update(
    { dongle_id: dongleId },
    { where: { uploads_ignored: isIgnored } },
  );

  // TODO check this change was processed..
  return true;
}

async function getAllDevicesFiltered() {
  return Devices.findAll();
}

async function updateLastPing(deviceId) {
  return Devices.update(
    { last_ping: Date.now() },
    { where: { dongle_id: deviceId } },
  );
}

async function isUserAuthorised(accountId, dongleId) {
  if (!accountId || !dongleId) {
    return { success: false, msg: 'bad_data' };
  }

  const account = await getAccountFromId(accountId);
  if (!account || !account.dataValues) {
    return { success: false, msg: 'bad_account', data: { authorised: false, account_id: accountId } };
  }

  const device = await getDeviceFromDongleId(dongleId);
  if (!device) {
    return { success: false, msg: 'bad_device', data: { authorised: false, dongle_id: dongleId } };
  }
  if (device.account_id !== account.id) {
    return { success: false, msg: 'not_authorised', data: { authorised: false, account_id: account.id, dongle_id: device.dongle_id } };
  }

  return {
    success: true,
    data: {
      authorised: true, account_id: account.id, dongle_id: device.dongle_id,
    },
  };
}

async function getOwnersFromDongle(dongleId) {
  const device = await getDeviceFromDongleId(dongleId);
  if (!device) {
    return { success: false };
  }
  return { success: true, data: [device.account_id] };
}

async function getDrives(dongleId, includeDeleted, includeMeta) {
  let query = { where: { dongle_id: dongleId }, order: [['created', 'DESC']] };

  if (!includeDeleted) {
    query = { ...query, where: { ...query.where, is_deleted: false } };
  }
  if (!includeMeta) {
    query = { ...query, attributes: { exclude: ['metadata'] } };
  }

  return Drives.findAll(query);
}

async function getDriveFromIdentifier(dongleId, identifier) {
  return Drives.findOne({ where: { dongle_id: dongleId, identifier } });
}

/*
    TODO: ADD AUTHENTICATION TO ENDPOINTS
*/

async function getCrashlogs(dongleId) {
  const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT).update(dongleId).digest('hex');

  const directoryTree = dirTree(`${process.env.STORAGE_PATH}${dongleId}/${dongleIdHash}/crash/`, { attributes: ['size'] });
  const crashlogFiles = (directoryTree ? directoryTree.children : []).map((file) => {
    const timeSplit = file.name.replace('boot-', '').replace('crash-', '').replace('.bz2', '').split('--');
    let timeString = `${timeSplit[0]} ${timeSplit[1].replace(/-/g, ':')}`;
    if (timeString.indexOf('_') > 0) {
      // eslint-disable-next-line prefer-destructuring
      timeString = timeString.split('_')[0];
    }

    let dateObj = null;
    try {
      dateObj = Date.parse(timeString);
    } catch (exception) {
      // do nothing
    }
    if (!dateObj) {
      dateObj = new Date(0);
    }

    return {
      name: file.name,
      size: file.size,
      date: dateObj,
      permalink: `${process.env.BASE_DRIVE_DOWNLOAD_URL}${dongleId}/${dongleIdHash}/crash/${file.name}`,
    };
  });
  crashlogFiles.sort((a, b) => ((a.date < b.date) ? 1 : -1));
  return crashlogFiles;
}

async function getBootlogs(dongleId) {
  const dongleIdHash = crypto.createHmac('sha256', process.env.APP_SALT).update(dongleId).digest('hex');

  const directoryTree = dirTree(`${process.env.STORAGE_PATH}${dongleId}/${dongleIdHash}/boot/`, { attributes: ['size'] });
  const bootlogFiles = (directoryTree ? directoryTree.children : []).map((file) => {
    const timeSplit = file.name.replace('boot-', '').replace('crash-', '').replace('.bz2', '').split('--');
    const timeString = `${timeSplit[0]} ${timeSplit[1].replace(/-/g, ':')}`;

    let dateObj = null;
    try {
      dateObj = Date.parse(timeString);
    } catch (exception) {
      // do nothing
    }
    if (!dateObj) dateObj = new Date(0);

    return {
      name: file.name,
      size: file.size,
      date: dateObj,
      permalink: `${process.env.BASE_DRIVE_DOWNLOAD_URL}${dongleId}/${dongleIdHash}/boot/${file.name}`,
    };
  });
  bootlogFiles.sort((a, b) => ((a.date < b.date) ? 1 : -1));
  return bootlogFiles;
}

async function updateOrCreateDrive(dongleId, identifier, data) {
  logger.info('updateOrCreate Drive', dongleId, identifier, data);
  const check = await Drives.findOne({ where: { dongle_id: dongleId, identifier } });

  logger.info('checking for existing drive....', check);

  if (check) {
    return Drives.update(data, { where: { dongle_id: dongleId, identifier } });
  }

  return Drives.create({
    ...data,
    dongle_id: dongleId,
    identifier,
  });
}

async function updateOrCreateDriveSegment(dongleId, identifier, segmentId, data) {
  logger.info('updateOrCreate Drive_Segment', dongleId, identifier, data);
  const check = await DriveSegments.findOne({
    where: { segment_id: segmentId, dongle_id: dongleId, drive_identifier: identifier },
  });

  if (check) {
    return DriveSegments.update(
      data,
      { where: { segment_id: segmentId, dongle_id: dongleId, drive_identifier: identifier } },
    );
  }

  return DriveSegments.create({
    ...data,
    segment_id: segmentId,
    drive_identifier: identifier,
    dongle_id: dongleId,
  });
}

async function getDriveSegment(driveIdentifier, segmentId) {
  return DriveSegments.findOne({
    where: {
      segment_id: segmentId,
      drive_identifier: driveIdentifier,
    },
  });
}

async function createDongle(dongleId, accountId, imei, serial, publicKey) {
  return Devices.create({
    dongle_id: dongleId,
    account_id: 0,
    imei,
    serial,
    device_type: 'freon',
    public_key: publicKey,
    created: Date.now(),
    last_ping: Date.now(),
    storage_used: 0,
  });
}

export default {
  pairDevice,
  unpairDevice,
  setDeviceNickname,
  getDevices,
  getDeviceFromDongleId,
  setIgnoredUploads,
  getAllDevicesFiltered,
  pairDeviceToAccountId,
  updateLastPing,
  isUserAuthorised,
  getOwnersFromDongle,
  createDongle,
  getDeviceFromSerial,
  updateDevice,

  // drive stuff, move maybe?
  getDrives,
  getBootlogs,
  getCrashlogs,
  getDriveFromIdentifier,
  updateOrCreateDrive,
  updateOrCreateDriveSegment,
  getDriveSegment,
};

import express from 'express';

import { AthenaReturnedData } from '../../../models';
import authenticationController from '../../controllers/authentication';
import deviceController from '../../controllers/devices';
import { isAuthenticated } from '../../middlewares/authentication';

// /api/realtime
const router = express.Router();

const whitelistParams = {
  getmessage: true,
  getversion: true,
  setnavdestination: true,
  listdatadirectory: true,
  reboot: true,
  uploadfiletourl: true,
  listuploadqueue: true,
  cancelupload: true,
  primeactivated: true,
  getpublickey: true,
  getsshauthorizedkeys: true,
  getsiminfo: true,
  getnetworktype: true,
  getnetworks: true,
  takesnapshot: true,
};

// TODO: use middleware to get device from dongle id

router.get('/:dongleId/connected', isAuthenticated, async (req, res) => {
  const { account, params: { dongleId } } = req;

  const device = await deviceController.getDeviceFromDongle(dongleId);
  if (!device) {
    return res.status(400).json({
      error: true,
      errorMsg: 'no_dongle',
      errorObject: { authenticated: true, dongle_exists: false },
    });
  }

  // TODO support delegation of access
  // TODO remove indication of dongle existing
  if (device.account_id !== account.id) {
    return res.status(403).json({
      error: true,
      errorMsg: 'unauthorised',
      errorObject: { authenticated: true, dongle_exists: true, authorised_user: false },
    });
  }

  // eslint-disable-next-line max-len
  const isConnected = await req.athenaWebsocketTemp.isDeviceConnected(account.id, device.id, dongleId);

  return res.status(200).json({
    success: true,
    dongle_id: device.dongle_id,
    data: isConnected,
  });
});

// TODO: change to POST request
router.get('/:dongleId/send/:method/', isAuthenticated, async (req, res) => {
  const { account, params: { dongleId, method } } = req;

  if (!whitelistParams[method.toLowerCase()]) {
    return res.status(409).json({
      error: true,
      errorMsg: 'invalid_method',
      errorObject: { method },
    });
  }

  const device = await deviceController.getDeviceFromDongle(dongleId);
  if (!device) {
    return res.status(400).json({
      error: true,
      errorMsg: 'no_dongle',
      errorObject: { authenticated: true, dongle_exists: false },
    });
  }

  // TODO support delegation of access
  // TODO remove indication of dongle existing
  if (device.account_id !== account.id) {
    return res.status(403).json({
      error: true,
      errorMsg: 'unauthorised',
      errorObject: { authenticated: true, dongle_exists: true, authorised_user: false },
    });
  }

  const data = await req.athenaWebsocketTemp.invoke(method, null, dongleId, account.id);

  return res.status(200).json({
    success: true,
    dongle_id: dongleId,
    method,
    data,
  });
});

router.get('/:dongle_id/get', async (req, res) => {
  const account = await authenticationController.getAuthenticatedAccount(req);
  if (account == null) {
    return res.status(403).json({
      error: true,
      errorMsg: 'Unauthenticated',
      errorObject: { authenticated: false },
    });
  }
  const device = await deviceController.getDeviceFromDongle(req.params.dongle_id);
  if (!device) {
    return res.status(400).json({
      error: true,
      errorMsg: 'no_dongle',
      errorObject: {
        authenticated: true,
        dongle_exists: false,
      },
    });
  }
  if (device.account_id !== account.id) {
    return res.status(403).json({
      error: true,
      errorMsg: 'unauthorised',
      errorObject: {
        authenticated: true,
        dongle_exists: true,
        authorised_user: false,
      },
    });
  }

  return res.json(await AthenaReturnedData.findAll({
    where: { device_id: device.id },
  }));
});

// TODO: change to POST request
router.get('/:dongle_id/temp/nav/:lat/:long', async (req, res) => {
  if (!req.params.lat || !req.params.long) {
    return res.status(403).json({ error: true, errorMsg: 'Malformed_Request', errorObject: { malformed: true } });
  }
  const account = await authenticationController.getAuthenticatedAccount(req);
  if (account == null) {
    return res.status(403).json({ error: true, errorMsg: 'Unauthenticated', errorObject: { authenticated: false } });
  }
  const device = await deviceController.getDeviceFromDongle(req.params.dongle_id);
  if (!device) {
    return res.status(400).json({ error: true, errorMsg: 'no_dongle', errorObject: { authenticated: true, dongle_exists: false } });
  }
  if (device.account_id !== account.id) {
    return res.status(403).json({ error: true, errorMsg: 'unauthorised', errorObject: { authenticated: true, dongle_exists: true, authorised_user: false } });
  }

  const data = await req.athenaWebsocketTemp.invoke('setNavDestination', { latitude: req.params.lat, longitude: req.params.long }, device.dongle_id, account.id);

  return res.status(200).json({
    success: true, dongle_id: device.dongle_id, method: req.params.method, data,
  });
});

export default router;
/**
 *  Copyright (C) 2014 3D Repo Ltd
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as
 *  published by the Free Software Foundation, either version 3 of the
 *  License, or (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

(() => {
	"use strict";

	const paypal = require("paypal-rest-sdk");
	const paypalTrans = require("./paypal_trans.js");
	const responseCodes = require("../response_codes.js");
	const moment = require("moment");
	const url = require("url");
	const C = require("../constants");
	const systemLogger = require("../logger.js").systemLogger;

	let updateBillingAddress = function (billingAgreementId, billingAddress) {
		const paypalAddress = paypalTrans.getPaypalAddress(billingAddress);

		let updateOps = [{
			"op": "replace",
			"path": "/",
			"value": {
				"shipping_address": billingAddress
			}
		}];

		return new Promise((resolve, reject) => {
			paypal.billingAgreement.update(billingAgreementId, updateOps, function (err, billingAgreement) {
				if (err) {
					let paypalError = JSON.parse(JSON.stringify(responseCodes.PAYPAL_ERROR));
					paypalError.message = err.response.message;
					reject(paypalError);
				} else {
					resolve(paypalAddress);
				}
			});
		});
	};

	let cancelOldAgreement = function(billingAgreementId) { 

		let cancel_note = {
			"note": "You have updated the licence subscriptions."
		};

		return new Promise((resolve, reject) => {
			paypal.billingAgreement.cancel(billingAgreementId, cancel_note, (err) => {
				if (err) {
					systemLogger.logError(JSON.stringify(err),{ 
						billingAgreementId: billingAgreementId
					});

					reject(err);
				} else {
					systemLogger.logInfo("Billing agreement cancelled successfully", { 
						billingAgreementId: billingAgreementId
					});
					resolve();
				}
			});
		});
	};

	let createBillingAgreement = function(billing, payments, paymentDate) { 
		let paymentDefs = [];
		let hasProRata = false;
		let proRataAmount = 0.0;
		let regularAmount = 0.0;
		let startDate = paymentDate;

		// Translate payments to paypal specific
		payments.forEach(function(payment) {
			if (payment.type === C.PRO_RATA_PAYMENT) { 
				hasProRata = true;
				proRataAmount += payment.gross;
			 } else if (payment.type === C.REGULAR_AMOUNT) {
				regularAmount += payment.gross;
			 }

			paymentDefs.push(paypalTrans.getPaypalPayment(payment));
		});

		let billingPlanAttributes = paypalTrans.getBillingPlanAttributes(billing.billingUser, paymentDefs);
		console.log(billingPlanAttributes);

		return new Promise((resolve, reject) => {

				// create plan
				paypal.billingPlan.create(billingPlanAttributes, function (err, billingPlan) {

					if (err) {
						let paypalError = JSON.parse(JSON.stringify(responseCodes.PAYPAL_ERROR));
						paypalError.message = err.response && err.response.message || err.message;
						reject(paypalError);
					} else {
						resolve(billingPlan);
					}
				});

			})
			.then(billingPlan => {

				//activate plan
				return new Promise((resolve, reject) => {
					let billingPlanUpdateAttributes = [{
						"op": "replace",
						"path": "/",
						"value": {
							"state": "ACTIVE"
						}
					}];

					paypal.billingPlan.update(billingPlan.id, billingPlanUpdateAttributes, function (err) {
						if (err) {
							let paypalError = JSON.parse(JSON.stringify(responseCodes.PAYPAL_ERROR));

							paypalError.message = err.response.message;
							reject(paypalError);
						} else {
							resolve(billingPlan);
						}
					});

				});
			})
			.then(billingPlan => {

				//create agreement
				return new Promise((resolve, reject) => {

					let desc = "";
					if (hasProRata) {
						desc += `This month's pro-rata: £${proRataAmount}. `;
					}
					desc += `Regular monthly recurring payment £${regularAmount}, starts on ${moment(billing.nextPaymentDate).utc().format('Do MMM YYYY')}`;

					let billingAgreementAttributes = paypalTrans.getBillingAgreementAttributes(
						billingPlan.id, 
						startDate, 
						paypalTrans.getPaypalAddress(billing.billingInfo),
						desc
					);
					console.log(billingAgreementAttributes);

					paypal.billingAgreement.create(billingAgreementAttributes, function (err, billingAgreement) {
						if (err) {
							let paypalError = JSON.parse(JSON.stringify(responseCodes.PAYPAL_ERROR));
							paypalError.message = err.response.message;
							reject(paypalError);
						} else {

							let link = billingAgreement.links.find(link => link.rel === "approval_url");
							let token = url.parse(link.href, true)
								.query.token;

							resolve({
								url: link.href,
								paypalPaymentToken: token,
								agreement: billingAgreement
							});
						}
					});

				});

			});

	};

	let processPayments = function(billing, payments, paymentDate) {
		// Cancel old agreements and then create new ones 

		// don't cancel agreement here. only cancel after executing billing agreement
		// otherwise if user decide not to complete the payment in paypal page it will
		// leave users with no agreements at all in their account
		//cancelOldAgreement(this).then(function() {
			return createBillingAgreement(billing, payments, paymentDate);
		//});
	};	

	module.exports = {
		updateBillingAddress: updateBillingAddress,
		processPayments: processPayments,
		cancelOldAgreement: cancelOldAgreement
	};

})();
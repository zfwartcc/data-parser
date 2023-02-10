import mongoose from 'mongoose';
import axios from 'axios';
import dotenv from 'dotenv';
import schedule from 'node-schedule';
import inside from 'point-in-polygon';
import Redis from 'ioredis';


import AtcOnline from './models/AtcOnline.js';
import PilotOnline from './models/PilotOnline.js';
import Pireps from './models/Pireps.js';
import ControllerHours from './models/ControllerHours.js';

dotenv.config();

const redis = new Redis(process.env.REDIS_URI);

redis.on('error', err => { throw new Error(`Failed to connect to Redis: ${err}`); });
redis.on('connect', () => console.log('Successfully connected to Redis'));

const zabApi = axios.create({
	baseURL: process.env.ZAB_API_URL,
	headers: {
		'Authorization': `Bearer ${process.env.ZAB_API_KEY}`
	}
});

const atcPos = ["ORD", "CHI", "SBN", "RFD", "PIA", "MSN", "MKG", "MLI", "MKE", "GRR", "FWA", "CMI", "CID", "AZO", "ALO", "EKM", "MDW", "LAF", "BTL", "OSH", "UGN", "ENW", "PWK", "MWC", "DEC", "GUS", "JVL", "VOK", "CMY", "ARR", "LOT"];
const airports = ["KALO","KAZO","KORD","KMDW","KMKE","KSBN","KEKM","KBTL","KGRR","KMKG","KRAC","KPWK","KARR","KDPA","KCID","KUES","KUGN","KMSN","KJVL","KGYY","KMLI","KOSH","KVOK","KDBQ","KDEC","KFWA","KGUS","KCMI","KLAF","KSFY","KCWI","KOQW","KTIP","KIKK","KDNV","KOOA","KOTM","4C8","4K6","KTVK","KFSW","KBRL","KFFL","KAWG","KGGI","KTZT","KMIW","KIFA","C25","KOLZ","KIIB","KVTI","C27","KPDC","KOVS","WS51","93C","26WN","KLNR","39WI","Y72","82C","KDAF","2WN5","67WI","63C","8WI0","Y50","0WI4","9WN1","WI55","31WN","WI67","WS46","KFLD","8D1","KSBM","KDLL","C47","91C","KUNU","KHXF","KETB","KRYV","61C","88C","57C","C89","KMWC","KRFD","KFEP","44C","KRPJ","KSQI","C73","KVYS","KLOT","KJOT","C56","KIGQ","KVPZ","KMGC","KPPO","KOXI","KRZL","KRWN","C65","KRCR","KASW","KGSH","KMCX","50I","KIWH","KOKK","KMZZ","KGWB","KHHG","KHAI","KIRS","KOEB","KANQ","C62","9D9","35D","KBIV","3GM","8DA","6D6","Y70","KFFX","C04","13C","8D4","08C","Z98","C91","C20","3HO","C56","2IL9","05C","KPNT","C75","KEZI","KGBG","KDVN","KMUT"];
const neighbors = ['ZID', 'ZMP', 'ZOB', 'ZKC'];

const airspace = [[27.95500000,-82.38333333],[27.95000000,-82.93833333],[28.15500000,-83.20500000],[28.40000000,-83.51666667],[28.55000000,-84.01666667],[28.16666667,-84.50000000],[28.05766667,-84.60950000],[28.03333333,-84.95000000],[27.50000000,-85.25000000],[27.00000000,-86.00000000],[26.60166667,-85.40833333],[26.20000000,-85.08833333],[25.03350000,-84.99316667],[24.00000000,-84.99316667],[24.00000000,-79.96638889],[24.00000000,-78.00000000],[22.58823657,-76.00000180],[22.00000000,-75.16666667],[20.00000000,-73.33333306],[20.41666667,-73.00000000],[20.41666667,-70.50000000],[19.64999972,-69.15000000],[21.23916639,-67.65055556],[25.00000000,-68.49250000],[25.00000000,-72.55205764],[25.00000000,-73.20000000],[27.83333306,-74.83333306],[27.83333306,-76.26444444],[28.18633333,-76.37600000],[29.76666667,-76.91750000],[30.00000000,-77.00000000],[30.00000000,-77.03333333],[30.05500000,-77.50000000],[30.09083333,-77.92066667],[30.15000000,-78.56666667],[30.15500000,-78.66666667],[30.20166667,-79.18416667]];

mongoose.set('toJSON', {virtuals: true});
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;
db.once('open', () => console.log('Successfully connected to MongoDB'));

const pollVatsim = async () => {
	await AtcOnline.deleteMany({}).exec();
	await PilotOnline.deleteMany({}).exec();
	
	console.log("Fetching data from VATSIM.");
	const {data} = await axios.get('https://data.vatsim.net/v3/vatsim-data.json');

	// PILOTS
	
	const dataPilots = [];
	
	let redisPilots = await redis.get('pilots');
	redisPilots = (redisPilots && redisPilots.length) ? redisPilots.split('|') : [];

	for(const pilot of data.pilots) { // Get all pilots that depart/arrive in ARTCC's airspace
		if(pilot.flight_plan !== null && (airports.includes(pilot.flight_plan.departure) || airports.includes(pilot.flight_plan.arrival) || inside([pilot.latitude, pilot.longitude], airspace))) {
			await PilotOnline.create({
				cid: pilot.cid,
				name: pilot.name,
				callsign: pilot.callsign,
				aircraft: pilot.flight_plan.aircraft_faa,
				dep: pilot.flight_plan.departure,
				dest: pilot.flight_plan.arrival,
				code: Math.floor(Math.random() * (999 - 101) + 101),
				lat: pilot.latitude,
				lng: pilot.longitude,
				altitude: pilot.altitude,
				heading: pilot.heading,
				speed: pilot.groundspeed,
				planned_cruise: pilot.flight_plan.altitude.includes("FL") ? (pilot.flight_plan.altitude.replace("FL", "") + '00') : pilot.flight_plan.altitude, // If flight plan altitude is 'FL350' instead of '35000'
				route: pilot.flight_plan.route,
				remarks: pilot.flight_plan.remarks
			});

			dataPilots.push(pilot.callsign);
			
			redis.hmset(`PILOT:${pilot.callsign}`,
				'callsign', pilot.callsign,
				'lat', `${pilot.latitude}`,
				'lng', `${pilot.longitude}`,
				'speed', `${pilot.groundspeed}`,
				'heading', `${pilot.heading}`,
				'altitude', `${pilot.altitude}`,
				'cruise', `${pilot.flight_plan.altitude.includes("FL") ? (pilot.flight_plan.altitude.replace("FL", "") + '00') : pilot.flight_plan.altitude}`,
				'destination', `${pilot.flight_plan.arrival}`,
			);
			redis.expire(`PILOT:${pilot.callsign}`, 300);
			redis.publish('PILOT:UPDATE', pilot.callsign);

		}
	}

	for(const pilot of redisPilots) {
		if(!dataPilots.includes(pilot)) {
			redis.publish('PILOT:DELETE', pilot);
		}
	}

	redis.set('pilots', dataPilots.join('|'));
	redis.expire(`pilots`, 65);
	
	// CONTROLLERS
	const dataControllers = [];
	let redisControllers = await redis.get('controllers');
	redisControllers = (redisControllers && redisControllers.length) ? redisControllers.split('|') : [];

	const dataNeighbors = [];

	for(const controller of data.controllers) { // Get all controllers that are online in ARTCC's airspace
		if(atcPos.includes(controller.callsign.slice(0, 3)) && controller.callsign !== "PRC_FSS" && controller.facility !== 0) {
			await AtcOnline.create({
				cid: controller.cid,
				name: controller.name,
				rating: controller.rating,
				pos: controller.callsign,
				timeStart: controller.logon_time,
				atis: controller.text_atis ? controller.text_atis.join(' - ') : '',
				frequency: controller.frequency
			});

			dataControllers.push(controller.callsign);

			const session = await ControllerHours.findOne({
				cid: controller.cid,
				timeStart: controller.logon_time
			});

			if(!session) {
				await ControllerHours.create({
					cid: controller.cid,
					timeStart: controller.logon_time,
					timeEnd: new Date(new Date().toUTCString()),
					position: controller.callsign
				});
				await zabApi.post(`/stats/fifty/${controller.cid}`);
				const queueName = 'myQueue';
				let datata = [{
					cid: controller.cid,
					name: controller.name,
					rating: controller.rating,
					pos: controller.callsign,
					timeStart: controller.logon_time,
					atis: controller.text_atis ? controller.text_atis.join(' - ') : '',
					frequency: controller.frequency}]
				let datatata = JSON.stringify(datata)

				redis.lpush(queueName, datatata, (error) => {
					if (error) {
						console.log(error);
					} else {
						//console.log('Item enqueued');
					}
				});


			} else {
				session.timeEnd = new Date(new Date().toUTCString());
				await session.save();
			}


		}
		const callsignParts = controller.callsign.split('_');
		if(neighbors.includes(callsignParts[0]) && callsignParts[callsignParts.length - 1] === "CTR") { // neighboring center
			dataNeighbors.push(callsignParts[0]);
		}
	}

	for(const atc of redisControllers) {
		if(!dataControllers.includes(atc)) {
			const queueName1 = '1231231231231231231231';

			let name123 = JSON.stringify(atc);

			redis.lpush(queueName1, name123, (error) => {
				if (error) {
					console.log(error);
				} else {
					//console.log('Item enqueued1');
				}
			});
			redis.publish('CONTROLLER:DELETE', atc);
		}
	}

	redis.set('controllers', dataControllers.join('|'));
	redis.expire(`controllers`, 65);
	redis.set('neighbors', dataNeighbors.join('|'));
	redis.expire(`neighbors`, 65);

	// METARS

	const airportsString = airports.join(","); // Get all METARs, add to database
	const response = await axios.get(`https://metar.vatsim.net/${airportsString}`);
	const metars = response.data.split("\n");

	for(const metar of metars) {
		redis.set(`METAR:${metar.slice(0,4)}`, metar);
	}

	// ATIS

	const dataAtis = [];
	let redisAtis = await redis.get('atis');
	redisAtis = (redisAtis && redisAtis.length) ? redisAtis.split('|') : [];

	for(const atis of data.atis) { // Find all ATIS connections within ARTCC's airspace
		const airport = atis.callsign.slice(0,4);
		if(airports.includes(airport)) {
			dataAtis.push(airport);
			redis.expire(`ATIS:${airport}`, 65);
		}
	}

	for(const atis of redisAtis) {
		if(!dataAtis.includes(atis)) {
			redis.publish('ATIS:DELETE', atis);
			redis.del(`ATIS:${atis}`);
		}
	}

	redis.set('atis', dataAtis.join('|'));
	redis.expire(`atis`, 65);
};

const getPireps = async () => {
	console.log('Fetching PIREPs.');
	let twoHours = new Date();
	twoHours = new Date(twoHours.setHours(twoHours.getHours() - 2));

	await Pireps.deleteMany({$or: [{manual: false}, {reportTime: {$lte: twoHours}}]}).exec();

	const pirepsJson = await axios.get('https://www.aviationweather.gov/cgi-bin/json/AirepJSON.php');
	const pireps = pirepsJson.data.features;
	for(const pirep of pireps) {
		if((pirep.properties.airepType === 'PIREP' || pirep.properties.airepType === 'Urgent PIREP') && inside(pirep.geometry.coordinates.reverse(), airspace) === true) { // Why do you put the coordinates the wrong way around, FAA? WHY?
			const wind = `${(pirep.properties.wdir ? pirep.properties.wdir : '')}${pirep.properties.wspd ? '@' + pirep.properties.wspd : ''}`;
			const icing = ((pirep.properties.icgInt1 ? pirep.properties.icgInt1 + ' ' : '') + (pirep.properties.icgType1 ? pirep.properties.icgType1 : '')).replace(/\s+/g,' ').trim();
			const skyCond = (pirep.properties.cloudCvg1 ? pirep.properties.cloudCvg1 + ' ' : '') + ( pirep.properties.Bas1 ? ('000' + pirep.properties.Bas1).slice(-3) : '') + (pirep.properties.Top1 ? '-' + ('000' + pirep.properties.Top1).slice(-3) : '');
			const turbulence = (pirep.properties.tbInt1 ? pirep.properties.tbInt1 + ' ' : '') + (pirep.properties.tbFreq1 ? pirep.properties.tbFreq1 + ' ' : '') + (pirep.properties.tbType1 ? pirep.properties.tbType1 : '').replace(/\s+/g,' ').trim();
			try {
				await Pireps.create({
					reportTime: pirep.properties.obsTime || '',
					location: pirep.properties.rawOb.slice(0,3) || '',
					aircraft: pirep.properties.acType || '',
					flightLevel: pirep.properties.fltlvl || '',
					skyCond: skyCond,
					turbulence: turbulence,
					icing: icing,
					vis: pirep.visibility_statute_mi ? pirep.visibility_statute_mi._text : '',
					temp: pirep.properties.temp ? pirep.properties.temp : '',
					wind: wind,
					urgent: pirep.properties.airepType === 'Urgent PIREP' ? true : false,
					raw: pirep.properties.rawOb,
					manual: false
				});
			} catch(e) {
				console.log(e);
			}
		}
	}
};


(async () =>{
	await redis.set('airports', airports.join('|'));
	await pollVatsim();
	await getPireps();
	schedule.scheduleJob('*/15 * * * * *', pollVatsim); // run every 15 seconds
	schedule.scheduleJob('*/2 * * * *', getPireps); // run every 2 minutes
})();

	

	

//https://www.aviationweather.gov/adds/dataserver_current/httpparam?dataSource=aircraftreports&requestType=retrieve&format=xml&minLat=30&minLon=-113&maxLat=37&maxLon=-100&hoursBeforeNow=2
//https://www.aviationweather.gov/cgi-bin/json/AirepJSON.php

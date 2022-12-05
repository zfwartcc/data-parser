import m from 'mongoose';

const atcOnlineSchema = new m.Schema({
	cid: Number,
	name: String,
	rating: Number,
	pos: String,
	timeStart: Date,
	atis: String,
	frequency: Number
}, {
	collection: "atcOnline"
});

export default m.model('AtcOnline', atcOnlineSchema);
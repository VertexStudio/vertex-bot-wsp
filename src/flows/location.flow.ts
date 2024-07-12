import { EVENTS, addKeyword } from "@builderbot/bot";

export const locationFlow = addKeyword(EVENTS.LOCATION).addAnswer(
	"I have received your location!",
	null,
	async (ctx) => {
		const userLatitude = ctx.message.locationMessage.degreesLatitude;
		const userLongitude = ctx.message.locationMessage.degreesLongitude;
		console.log(userLatitude, userLongitude);
	}
);
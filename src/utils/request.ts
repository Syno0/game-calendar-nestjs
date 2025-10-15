export async function request(url, options) {
	const response = await fetch(url, options);
	let result;
	if (response.status < 200 || response.status >= 300) {
		try {
			result = await response.json();
			result = result.message ? result.message : response.statusText;
		} catch (err) {
			console.error(err);
			result = response;
		}
		throw result;
	}

	try {
		result = await response.json();
	} catch (err) {
		console.error(err);
		result = response;
	}
	return result;
}

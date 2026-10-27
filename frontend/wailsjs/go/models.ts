export namespace main {
	
	export class ComposeRequest {
	    text: string;
	    style: string;
	    durationSec: number;
	
	    static createFrom(source: any = {}) {
	        return new ComposeRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.text = source["text"];
	        this.style = source["style"];
	        this.durationSec = source["durationSec"];
	    }
	}
	export class ComposeResponse {
	    spec?: schema.MusicSpec;
	    source: string;
	    notice: string;
	
	    static createFrom(source: any = {}) {
	        return new ComposeResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.spec = this.convertValues(source["spec"], schema.MusicSpec);
	        this.source = source["source"];
	        this.notice = source["notice"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SaveHistoryRequest {
	    text: string;
	    style: string;
	    durationSec: number;
	    spec: number[];
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new SaveHistoryRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.text = source["text"];
	        this.style = source["style"];
	        this.durationSec = source["durationSec"];
	        this.spec = source["spec"];
	        this.source = source["source"];
	    }
	}

}

export namespace schema {
	
	export class Mix {
	    reverb: number;
	    sidechain: number;
	    lofiCharacter: number;
	
	    static createFrom(source: any = {}) {
	        return new Mix(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.reverb = source["reverb"];
	        this.sidechain = source["sidechain"];
	        this.lofiCharacter = source["lofiCharacter"];
	    }
	}
	export class Mood {
	    valence: number;
	    energy: number;
	    tension: number;
	    warmth: number;
	
	    static createFrom(source: any = {}) {
	        return new Mood(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.valence = source["valence"];
	        this.energy = source["energy"];
	        this.tension = source["tension"];
	        this.warmth = source["warmth"];
	    }
	}
	export class Section {
	    name: string;
	    bars: number;
	    energy: number;
	    chords: string[];
	    bassPattern: string;
	    drumPattern: string;
	    layers: string[];
	
	    static createFrom(source: any = {}) {
	        return new Section(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.bars = source["bars"];
	        this.energy = source["energy"];
	        this.chords = source["chords"];
	        this.bassPattern = source["bassPattern"];
	        this.drumPattern = source["drumPattern"];
	        this.layers = source["layers"];
	    }
	}
	export class MusicSpec {
	    mood: Mood;
	    style: string;
	    tempo: number;
	    key: string;
	    seed: number;
	    sections: Section[];
	    mix: Mix;
	
	    static createFrom(source: any = {}) {
	        return new MusicSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mood = this.convertValues(source["mood"], Mood);
	        this.style = source["style"];
	        this.tempo = source["tempo"];
	        this.key = source["key"];
	        this.seed = source["seed"];
	        this.sections = this.convertValues(source["sections"], Section);
	        this.mix = this.convertValues(source["mix"], Mix);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace store {
	
	export class HistoryEntry {
	    id: string;
	    text: string;
	    style: string;
	    durationSec: number;
	    spec: number[];
	    source: string;
	    favorite: boolean;
	    // Go type: time
	    createdAt: any;
	
	    static createFrom(source: any = {}) {
	        return new HistoryEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.text = source["text"];
	        this.style = source["style"];
	        this.durationSec = source["durationSec"];
	        this.spec = source["spec"];
	        this.source = source["source"];
	        this.favorite = source["favorite"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Settings {
	    apiKey: string;
	    baseUrl: string;
	    model: string;
	    firstRunDone: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiKey = source["apiKey"];
	        this.baseUrl = source["baseUrl"];
	        this.model = source["model"];
	        this.firstRunDone = source["firstRunDone"];
	    }
	}

}


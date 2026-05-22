<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '$lib/tokens.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-frame">
	{@render children()}
</div>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		background: var(--surface-base);
		color: var(--text-primary);
		font-family: var(--body-family);
	}

	:global(*:focus-visible) {
		outline: var(--focus-ring-width) solid var(--focus-ring-color);
		outline-offset: var(--focus-ring-offset);
	}

	.app-frame {
		min-height: 100vh;
		padding: var(--space-xl);
	}
</style>

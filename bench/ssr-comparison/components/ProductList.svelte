<script>
let { products } = $props()
</script>

<ul class="products">{#each products as product (product.id)}<li data-id={String(product.id)}><span>{product.name}</span><b>{String(product.qty)}</b></li>{/each}</ul>
